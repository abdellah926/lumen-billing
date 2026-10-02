import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Database-backed OAuth tests.
 *
 * `oauth.test.mjs` covers the decision rules in isolation; this covers the parts that only
 * exist because there is a database: single-use authorization state, expiry, the uniqueness
 * constraint that stops one upstream identity being claimed twice, and the password state
 * flag that prevents locking somebody out.
 *
 * These run against a throwaway database, so the SQL and the constraints are the ones that
 * would run in production rather than a paraphrase of them.
 */

const dir = mkdtempSync(path.join(tmpdir(), "lumen-oauth-"));
process.env.LUMEN_DATA_DIR = dir;
process.env.LUMEN_STORAGE_DIR = path.join(dir, "storage");

const { db, closeDb } = await import("../src/lib/db.ts");
const { createTransaction, consumeTransaction, safeReturnTo, purgeExpiredTransactions } =
  await import("../src/lib/oauth/transactions.ts");
const { createOAuthUser, insertIdentity, identityStore, listIdentities, deleteIdentity } =
  await import("../src/lib/oauth/identities.ts");
const { hasPassword, setPassword } = await import("../src/lib/password-state.ts");
const { verifyPassword } = await import("../src/lib/auth.ts");
const { resolveExternalIdentity } = await import("../src/lib/oauth/resolve.ts");

let passed = 0;
const failures = [];
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
    })
    .catch((err) => {
      failures.push({ name, err });
    });
}

const now = () => new Date().toISOString();

/* -------------------------------------------- authorization state is single-use */

await test("a transaction is returned exactly once", () => {
  const state = createTransaction({
    provider: "google",
    intent: "signin",
    redirectUri: "http://localhost:3100/api/auth/google/callback",
    codeVerifier: "a".repeat(43),
    nonce: "n",
  });
  const first = consumeTransaction(state);
  assert.ok(first, "first read should find the transaction");
  assert.equal(first.provider, "google");

  const second = consumeTransaction(state);
  assert.equal(second, undefined, "a replayed state must find nothing");
});

await test("an unknown state finds nothing", () => {
  assert.equal(consumeTransaction("never-issued"), undefined);
});

await test("an expired transaction is refused and cleaned up", () => {
  const state = createTransaction({
    provider: "github",
    intent: "signin",
    redirectUri: "http://localhost:3100/api/auth/github/callback",
    codeVerifier: "b".repeat(43),
    nonce: "n",
  });
  // Rewind the row past its expiry, which is what waiting ten minutes would do.
  const past = new Date(Date.now() - 60_000).toISOString();
  db()
    .prepare("UPDATE oauth_transactions SET expires_at = ? WHERE state = ?")
    .run(past, state);

  assert.equal(consumeTransaction(state), undefined);

  const left = db()
    .prepare("SELECT COUNT(*) c FROM oauth_transactions WHERE state = ?")
    .get(state);
  assert.equal(Number(left.c), 0, "an expired transaction should not be left behind");
});

await test("the sweeper removes stale rows and keeps live ones", () => {
  const live = createTransaction({
    provider: "discord",
    intent: "signin",
    redirectUri: "http://x/api/auth/discord/callback",
    codeVerifier: "c".repeat(43),
    nonce: "n",
  });
  const dead = createTransaction({
    provider: "discord",
    intent: "signin",
    redirectUri: "http://x/api/auth/discord/callback",
    codeVerifier: "d".repeat(43),
    nonce: "n",
  });
  db()
    .prepare("UPDATE oauth_transactions SET expires_at = ? WHERE state = ?")
    .run(new Date(Date.now() - 60_000).toISOString(), dead);

  purgeExpiredTransactions();

  assert.ok(
    db().prepare("SELECT 1 FROM oauth_transactions WHERE state = ?").get(live),
    "a live transaction must survive the sweep",
  );
  assert.equal(
    db().prepare("SELECT 1 FROM oauth_transactions WHERE state = ?").get(dead),
    undefined,
    "an expired transaction should be swept",
  );
  consumeTransaction(live);
});

await test("a link transaction records the account it belongs to", () => {
  // A real user id: oauth_transactions.user_id is a foreign key, so an invented id is refused.
  // That refusal is itself the behaviour worth knowing — a link request cannot name an account
  // that does not exist, so `?user_id=` tampering cannot aim the flow at another account.
  const owner = "u-link-owner";
  db()
    .prepare(
      "INSERT INTO users (id, email, name, password, password_login_enabled, created_at) VALUES (?,?,?,?,1,?)",
    )
    .run(owner, "link-owner@example.com", "Owner", "scrypt$x$y", now());

  assert.throws(
    () =>
      createTransaction({
        provider: "github",
        intent: "link",
        redirectUri: "http://localhost:3100/api/auth/github/callback",
        codeVerifier: "e".repeat(43),
        nonce: "n",
        userId: "u-does-not-exist",
      }),
    /FOREIGN KEY/i,
    "naming an account that does not exist must fail at the foreign key",
  );

  const state = createTransaction({
    provider: "github",
    intent: "link",
    redirectUri: "http://localhost:3100/api/auth/github/callback",
    codeVerifier: "e".repeat(43),
    nonce: "n",
    userId: owner,
    returnTo: "/account/connections",
  });
  const row = consumeTransaction(state);
  assert.equal(row.intent, "link");
  assert.equal(row.user_id, owner);
  assert.equal(row.return_to, "/account/connections");
});

/* ------------------------------------------------------- open-redirect guards */

await test("returnTo accepts same-site paths", () => {
  assert.equal(safeReturnTo("/library"), "/library");
  assert.equal(safeReturnTo("/library?folder=images"), "/library?folder=images");
});

await test("returnTo refuses anything that could leave the site", () => {
  for (const hostile of [
    "https://evil.example/steal",
    "//evil.example/steal",
    "http://evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "\\\\evil.example",
    "",
    null,
    undefined,
  ]) {
    assert.equal(safeReturnTo(hostile), null, `must refuse ${JSON.stringify(hostile)}`);
  }
});

await test("a hostile returnTo never reaches storage", () => {
  const state = createTransaction({
    provider: "google",
    intent: "signin",
    redirectUri: "http://x/cb",
    codeVerifier: "f".repeat(43),
    nonce: "n",
    returnTo: "https://evil.example/steal",
  });
  const row = consumeTransaction(state);
  assert.equal(row.return_to, null);
});

/* ------------------------------------------------------- accounts and identities */

let oauthUser;
await test("an OAuth account is created with no usable password", async () => {
  oauthUser = await createOAuthUser("OAuth.Person@Example.com", "OAuth Person");
  assert.equal(oauthUser.email, "oauth.person@example.com", "email should be normalised");

  const row = db().prepare("SELECT password FROM users WHERE id = ?").get(oauthUser.id);
  assert.ok(row.password.startsWith("scrypt$"), "should still hold a well-formed hash");

  // The decisive property: nothing anyone can type will match it.
  const guesses = ["", "password", oauthUser.email, "oauth.person@example.com"];
  for (const g of guesses) {
    assert.equal(await verifyPassword(g, row.password), false, `guess ${g} must fail`);
  }
});

await test("an OAuth account reports that it has no password", () => {
  assert.equal(hasPassword(oauthUser.id), false);
});

await test("setting a password makes the account password-capable", async () => {
  await setPassword(oauthUser.id, "correct horse battery");
  assert.equal(hasPassword(oauthUser.id), true);

  const row = db().prepare("SELECT password FROM users WHERE id = ?").get(oauthUser.id);
  assert.equal(await verifyPassword("correct horse battery", row.password), true);
  assert.equal(await verifyPassword("wrong", row.password), false);
});

await test("a normal email account reports that it has a password", async () => {
  const { hashPassword } = await import("../src/lib/auth.ts");
  const id = "u-email-user";
  db()
    .prepare(
      "INSERT INTO users (id, email, name, password, password_login_enabled, created_at) VALUES (?,?,?,?,1,?)",
    )
    .run(id, "plain@example.com", "Plain", await hashPassword("a-real-password"), now());
  assert.equal(hasPassword(id), true);
});

await test("an identity is stored and found exactly once", () => {
  insertIdentity(oauthUser.id, "google", {
    providerAccountId: "google-sub-1",
    email: "oauth.person@example.com",
    emailVerified: true,
    name: "OAuth Person",
  });

  const found = identityStore.findIdentity("google", "google-sub-1");
  assert.deepEqual(found, { userId: oauthUser.id });
  assert.equal(identityStore.findIdentity("google", "google-sub-1").userId, oauthUser.id);
  assert.equal(listIdentities(oauthUser.id).length, 1);
});

await test("one upstream identity cannot be claimed by a second account", () => {
  const other = "u-other-user";
  db()
    .prepare(
      "INSERT INTO users (id, email, name, password, password_login_enabled, created_at) VALUES (?,?,?,?,1,?)",
    )
    .run(other, "other@example.com", "Other", "scrypt$x$y", now());

  assert.throws(
    () =>
      insertIdentity(other, "google", {
        providerAccountId: "google-sub-1",
        email: "other@example.com",
        emailVerified: true,
        name: "Other",
      }),
    /UNIQUE|constraint/i,
    "the UNIQUE(provider, provider_account_id) index should reject this",
  );
});

await test("verification status is recorded, not assumed", () => {
  const unverifiedUser = "u-unverified";
  db()
    .prepare(
      "INSERT INTO users (id, email, name, password, password_login_enabled, created_at) VALUES (?,?,?,?,1,?)",
    )
    .run(unverifiedUser, "fb@example.com", "FB", "scrypt$x$y", now());

  insertIdentity(unverifiedUser, "facebook", {
    providerAccountId: "fb-1",
    email: "fb@example.com",
    emailVerified: false,
    name: "FB",
  });

  const row = listIdentities(unverifiedUser)[0];
  assert.equal(row.email_verified, 0, "Facebook's silence must not be stored as verified");
});

await test("a stored identity resolves to a sign-in for its owner", () => {
  const r = resolveExternalIdentity(
    {
      provider: "google",
      profile: {
        providerAccountId: "google-sub-1",
        email: "oauth.person@example.com",
        emailVerified: true,
        name: "OAuth Person",
      },
      intent: "signin",
    },
    identityStore,
  );
  assert.equal(r.kind, "signin");
  assert.equal(r.userId, oauthUser.id);
});

await test("deleting an identity is scoped to the owning account", () => {
  assert.equal(deleteIdentity("u-other-user", "google"), false, "must not delete another's row");
  assert.equal(deleteIdentity(oauthUser.id, "google"), true);
  assert.equal(identityStore.findIdentity("google", "google-sub-1"), undefined);
});

/* --------------------------------------------------------------------- report */

for (const { name, err } of failures) {
  console.error(`FAIL  ${name}\n      ${err.message.split("\n")[0]}`);
}
console.log(`\noauth-db: ${passed} passed, ${failures.length} failed`);
closeDb();
process.exit(failures.length === 0 ? 0 : 1);
