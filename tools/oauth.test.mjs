import assert from "node:assert/strict";

/**
 * OAuth identity-resolution tests.
 *
 * These cover the rule that the brief is most specific about: a matching email address
 * must never, on its own, hand over an existing account. Every branch of
 * `resolveExternalIdentity` is exercised here against an in-memory store, because a
 * regression in this function is silent account takeover rather than a visible bug.
 *
 * No database is needed, and deliberately so: `resolve.ts` is pure, and this suite is the
 * thing that keeps it that way. If someone later reaches for the database inside it, the
 * suite is the first thing that has to be rewritten, which is a useful speed bump.
 */

const { resolveExternalIdentity, describeLinkRefusal, describeReject } = await import(
  "../src/lib/oauth/resolve.ts"
);
const { publicProviders, enabledProviders, isConfigured, OAUTH_PROVIDERS, OAUTH_PROVIDER_ORDER } =
  await import("../src/lib/oauth/providers.ts");

/* ------------------------------------------------------------------ store stub */

function makeStore({ identities = {}, users = {} } = {}) {
  return {
    findIdentity(provider, providerAccountId) {
      return identities[`${provider}:${providerAccountId}`];
    },
    findUserByEmail(email) {
      return users[email.toLowerCase()];
    },
  };
}

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    failures.push({ name, err });
  }
}

const profile = (over = {}) => ({
  providerAccountId: "sub-1",
  email: "person@example.com",
  emailVerified: true,
  name: "Person",
  ...over,
});

/* --------------------------------------------- rule 1: known identity signs in */

test("a known identity signs its owner in", () => {
  const store = makeStore({
    identities: { "github:sub-1": { userId: "u-existing" } },
  });
  const r = resolveExternalIdentity(
    { provider: "github", profile: profile(), intent: "signin" },
    store,
  );
  assert.equal(r.kind, "signin");
  assert.equal(r.userId, "u-existing");
});

test("a known identity signs in even when the email later changed upstream", () => {
  // The provider account is the stable subject. Re-reading a changed email must not
  // strand somebody who renamed their address, nor re-point the identity elsewhere.
  const store = makeStore({
    identities: { "github:sub-1": { userId: "u-existing" } },
    users: { "new@example.com": { id: "someone-else" } },
  });
  const r = resolveExternalIdentity(
    { provider: "github", profile: profile({ email: "new@example.com" }), intent: "signin" },
    store,
  );
  assert.equal(r.kind, "signin");
  assert.equal(r.userId, "u-existing");
});

/* -------------------------------------------------- rule 2: first OAuth signs up */

test("an unseen identity on a free address creates an account", () => {
  const r = resolveExternalIdentity(
    { provider: "google", profile: profile(), intent: "signin" },
    makeStore(),
  );
  assert.equal(r.kind, "create");
  assert.equal(r.email, "person@example.com");
});

test("email is normalised before the free-address check", () => {
  const store = makeStore({ users: { "person@example.com": { id: "u-1" } } });
  const r = resolveExternalIdentity(
    { provider: "google", profile: profile({ email: "  Person@Example.COM " }), intent: "signin" },
    store,
  );
  assert.equal(r.kind, "link_required");
});

/* -------------------------------- rule 3: matching email must NOT grant access */

test("a verified match on an existing account is refused, not adopted", () => {
  const store = makeStore({ users: { "person@example.com": { id: "u-victim" } } });
  const r = resolveExternalIdentity(
    { provider: "google", profile: profile({ emailVerified: true }), intent: "signin" },
    store,
  );
  assert.equal(r.kind, "link_required");
  assert.equal(r.existingUserId, "u-victim");
  assert.equal(r.reason, "account_exists");
});

test("an unverified match is refused with the weaker reason", () => {
  // Facebook never asserts verification, so this is the branch it always takes.
  const store = makeStore({ users: { "person@example.com": { id: "u-1" } } });
  const r = resolveExternalIdentity(
    { provider: "facebook", profile: profile({ emailVerified: false }), intent: "signin" },
    store,
  );
  assert.equal(r.kind, "link_required");
  assert.equal(r.reason, "email_not_verified");
});

test("refusal copy never implies the account was opened", () => {
  const copy = describeLinkRefusal("account_exists");
  assert.match(copy, /account settings/i);
  assert.doesNotMatch(copy, /signed you in|logged you in/i);
});

test("unverified refusal explains why verification mattered", () => {
  const copy = describeLinkRefusal("email_not_verified");
  assert.match(copy, /did not confirm/i);
});

/* ------------------------------------------------- refusals when no email exists */

test("a provider that omits the email cannot create an account", () => {
  const r = resolveExternalIdentity(
    { provider: "x", profile: profile({ email: null }), intent: "signin" },
    makeStore(),
  );
  assert.equal(r.kind, "reject");
  assert.equal(r.reason, "provider_returned_no_email");
});

test("a provider with no email cannot bypass an existing account either", () => {
  const store = makeStore({ users: { "person@example.com": { id: "u-1" } } });
  const r = resolveExternalIdentity(
    { provider: "x", profile: profile({ email: null }), intent: "signin" },
    store,
  );
  assert.equal(r.kind, "reject");
});

test("rejection copy points at email signup instead of dead-ending", () => {
  const copy = describeReject("provider_returned_no_email", "X");
  assert.match(copy, /X/);
  assert.match(copy, /email address and password/i);
});

test("a missing subject is rejected before anything is created", () => {
  const r = resolveExternalIdentity(
    { provider: "google", profile: profile({ providerAccountId: "" }), intent: "signin" },
    makeStore(),
  );
  assert.equal(r.kind, "reject");
  assert.equal(r.reason, "provider_returned_no_id");
});

/* --------------------------------------------------------------- link intent */

test("linking attaches a new identity to the signed-in account", () => {
  const r = resolveExternalIdentity(
    {
      provider: "discord",
      profile: profile({ providerAccountId: "discord-9" }),
      intent: "link",
      signedInUserId: "u-mine",
    },
    makeStore(),
  );
  assert.equal(r.kind, "link");
  assert.equal(r.userId, "u-mine");
});

test("linking does not require the provider email to match the account", () => {
  // The session is the authorisation, not the address, so a second address is fine.
  const store = makeStore({ users: { "mine@example.com": { id: "u-mine" } } });
  const r = resolveExternalIdentity(
    {
      provider: "discord",
      profile: profile({ providerAccountId: "d-1", email: "other@example.com" }),
      intent: "link",
      signedInUserId: "u-mine",
    },
    store,
  );
  assert.equal(r.kind, "link");
  assert.equal(r.userId, "u-mine");
});

test("linking still refuses an identity already held by another account", () => {
  const store = makeStore({
    identities: { "discord:d-1": { userId: "u-other" } },
  });
  const r = resolveExternalIdentity(
    {
      provider: "discord",
      profile: profile({ providerAccountId: "d-1" }),
      intent: "link",
      signedInUserId: "u-mine",
    },
    store,
  );
  assert.equal(r.kind, "reject");
  assert.equal(r.reason, "identity_belongs_to_another_account");
});

test("re-linking an identity that is already ours is a harmless no-op", () => {
  const store = makeStore({ identities: { "discord:d-1": { userId: "u-mine" } } });
  const r = resolveExternalIdentity(
    {
      provider: "discord",
      profile: profile({ providerAccountId: "d-1" }),
      intent: "link",
      signedInUserId: "u-mine",
    },
    store,
  );
  assert.equal(r.kind, "signin");
  assert.equal(r.userId, "u-mine");
});

test("link without a session is refused", () => {
  const r = resolveExternalIdentity(
    { provider: "discord", profile: profile(), intent: "link" },
    makeStore(),
  );
  assert.equal(r.kind, "reject");
  assert.equal(r.reason, "no_signed_in_account");
});

test("link tolerates a provider that exposes no email, which is how X links at all", () => {
  // X API v2 has no email on /2/users/me. Linking is authorised by the session, so a null
  // address is recorded as null rather than blocking a connection the user asked for.
  const r = resolveExternalIdentity(
    {
      provider: "x",
      profile: profile({ providerAccountId: "x-1", email: null }),
      intent: "link",
      signedInUserId: "u-mine",
    },
    makeStore(),
  );
  assert.equal(r.kind, "link");
  assert.equal(r.userId, "u-mine");
  assert.equal(r.email, null);
});

/* ---------------------------------------------------------- provider registry */

test("all five requested providers exist, with distinct env pairs", () => {
  assert.deepEqual([...OAUTH_PROVIDER_ORDER].sort(), [
    "discord",
    "facebook",
    "github",
    "google",
    "x",
  ]);
  const seen = new Set();
  for (const id of OAUTH_PROVIDER_ORDER) {
    const p = OAUTH_PROVIDERS[id];
    assert.ok(p.label.length > 0, `${id} needs a label`);
    assert.ok(p.issuer.startsWith("https://"), `${id} issuer must be https`);
    // Issuer must be a bare origin. A stray path would make openid-client build a
    // discovery URL that does not exist, and the failure would look like a network blip.
    const issuerUrl = new URL(p.issuer);
    assert.equal(issuerUrl.pathname, "/", `${id} issuer must have no path`);
    assert.equal(issuerUrl.search, "", `${id} issuer must have no query`);
    for (const v of [p.env.clientId, p.env.clientSecret]) {
      assert.ok(!seen.has(v), `env var ${v} is reused between providers`);
      seen.add(v);
    }
  }
});

test("every provider declares a label and an email-verification note", () => {
  for (const id of OAUTH_PROVIDER_ORDER) {
    const p = OAUTH_PROVIDERS[id];
    assert.ok(p.emailClaimNote.length > 10, `${id} needs an emailClaimNote`);
    assert.ok(p.scopes.length > 0, `${id} needs scopes`);
    assert.ok(p.tokenEndpoint.startsWith("https://"), `${id} token endpoint must be https`);
  }
});

test("only Google is treated as an OIDC provider", () => {
  // Getting this wrong means trusting an unsigned JSON response as if it were a signed
  // assertion, so it is pinned rather than derived.
  assert.equal(OAUTH_PROVIDERS.google.profile, "oidc");
  for (const id of ["x", "facebook", "discord", "github"]) {
    assert.notEqual(OAUTH_PROVIDERS[id].profile, "oidc");
  }
});

test("an unconfigured provider is hidden rather than shown disabled", () => {
  for (const id of OAUTH_PROVIDER_ORDER) {
    delete process.env[OAUTH_PROVIDERS[id].env.clientId];
    delete process.env[OAUTH_PROVIDERS[id].env.clientSecret];
  }
  assert.equal(enabledProviders().length, 0);
  assert.equal(publicProviders().length, 5, "all five are still described to the page");
});

test("a provider with only an id stays hidden", () => {
  const p = OAUTH_PROVIDERS.google;
  process.env[p.env.clientId] = "id-only";
  delete process.env[p.env.clientSecret];
  assert.equal(isConfigured(p), false, "a half-configured provider must not render");
  assert.equal(enabledProviders().length, 0);
});

test("a fully configured provider is exposed by id and label only", () => {
  const p = OAUTH_PROVIDERS.google;
  process.env[p.env.clientId] = "client-id";
  process.env[p.env.clientSecret] = "client-secret";
  assert.equal(isConfigured(p), true);
  const exposed = enabledProviders();
  assert.equal(exposed.length, 1);
  assert.deepEqual(Object.keys(exposed[0]).sort(), ["configured", "id", "label"]);
  const serialised = JSON.stringify(publicProviders());
  assert.doesNotMatch(serialised, /client-secret/);
  assert.doesNotMatch(serialised, /client-id/);
});

test("blank or whitespace credentials do not count as configured", () => {
  const p = OAUTH_PROVIDERS.github;
  process.env[p.env.clientId] = "   ";
  process.env[p.env.clientSecret] = "secret";
  assert.equal(isConfigured(p), false);
});

/* ----------------------------------------------------------------------- report */

for (const { name, err } of failures) {
  console.error(`FAIL  ${name}\n      ${err.message.split("\n")[0]}`);
}
console.log(`\noauth: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
