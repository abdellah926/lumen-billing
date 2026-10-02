/**
 * Sandbox admin flag, set directly in SQL.
 *
 * `is_admin` has to be set before anyone can reach the page that would otherwise set it, so
 * this is the bootstrap path. It goes through raw SQL rather than `lib/billing/admin.ts`
 * because that module imports `next/headers` through `auth.ts`, which is not resolvable
 * outside a request — a detail that is correct in the app and inconvenient in a script.
 *
 * Prints before and after so the caller can confirm which row changed.
 */

const dbFile = "data/lumen.db";
const email = process.argv[2];

// Imported by path rather than through the app's alias so this stays runnable with plain node.
const { DatabaseSync } = await import("node:sqlite");

const db = new DatabaseSync(dbFile);
const before = db.prepare("SELECT id, email, is_admin FROM users").all();
console.log("before:", JSON.stringify(before));

const target = email
  ? db.prepare("SELECT id, email FROM users WHERE email = ?").get(email)
  : before[0];

if (!target) {
  console.log(`no user matches ${email ?? "(first row)"}`);
} else {
  db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(target.id);
  console.log("granted admin to:", target.email);
  console.log("after: ", JSON.stringify(db.prepare("SELECT id, email, is_admin FROM users").all()));
}

db.close();
