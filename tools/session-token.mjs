import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";

/**
 * Issues a session token straight into the database, for screenshotting and scripted checks of
 * pages that require a sign-in.
 *
 * This bypasses the login form on purpose and that difference matters: the token is written the
 * way `auth.ts` writes it — sha256 of the token, not the token itself — so if the app ever
 * changed that, this script would produce a token the app rejects rather than quietly passing a
 * check the real login would fail. It only proves the pages render for a session that exists,
 * not that sign-in works.
 *
 * The cookie is hashed here exactly as `hashToken` does in `src/lib/auth.ts`. Change one, and
 * change both.
 *
 *   node tools/session-token.mjs [minutes]
 */

const minutes = Number(process.argv[2] ?? 60);
const dbFile = "data/lumen.db";

const db = new DatabaseSync(dbFile);

const users = db.prepare("SELECT id, email FROM users").all();
if (users.length === 0) {
  console.error("no users exist; sign up through the app first");
  process.exit(1);
}

// Only the first account, because granting a session to the wrong one would be a silent way
// to look at someone else's library.
const user = users[0];

const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");

db.prepare(
  "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
).run(hash, user.id, new Date(Date.now() + minutes * 60_000).toISOString(), new Date().toISOString());

db.close();

console.log(`lumen_session=${token}`);
console.error(`session issued for ${user.email}, valid ${minutes} minutes`);
