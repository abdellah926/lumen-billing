import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/lumen.db");

const tables = db
  .prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND (name LIKE 'oauth%' OR name LIKE 'canva%')
     ORDER BY name`,
  )
  .all();
console.log("new tables:", tables.map((t) => t.name).join(", ") || "(none)");

const cols = db
  .prepare("PRAGMA table_info(users)")
  .all()
  .map((c) => c.name);
console.log("users.password_login_enabled present:", cols.includes("password_login_enabled"));

console.log("users preserved:", db.prepare("SELECT COUNT(*) c FROM users").get().c);
console.log("library items preserved:", db.prepare("SELECT COUNT(*) c FROM library_items").get().c);
console.log("identities (expected 0):", db.prepare("SELECT COUNT(*) c FROM oauth_identities").get().c);
db.close();
