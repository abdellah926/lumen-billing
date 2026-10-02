import "server-only";

import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { randomBytes } from "node:crypto";

/**
 * Whether an account can be signed into with a password, and how one gets added.
 *
 * Accounts created by a provider sign-in have a well-formed password hash that nothing can
 * match. That is deliberate — a placeholder like an empty string would quietly open a
 * password login nobody asked for — but it leaves a real question the database cannot
 * otherwise answer: if this person's only provider identity is disconnected, are they now
 * locked out with no way back?
 *
 * The answer is a column, not a guess about the hash. Sniffing whether a scrypt hash
 * corresponds to some known placeholder would depend on how the placeholder was generated,
 * and would silently start reporting "locked out" for a real account whose password simply
 * happened to look like one.
 */
export function hasPassword(userId: string): boolean {
  const row = db()
    .prepare("SELECT password_login_enabled FROM users WHERE id = ?")
    .get(userId) as { password_login_enabled: number } | undefined;
  return row ? row.password_login_enabled === 1 : false;
}

/**
 * Gives a provider-created account a real password.
 *
 * Replaces the unreachable hash rather than adding a second one, because there is only
 * ever one password column. Turning the flag on at the same time keeps the two in step; if
 * they could disagree, `hasPassword` would eventually claim an account is password-enabled
 * when its hash is still the discarded random value.
 */
export async function setPassword(userId: string, password: string): Promise<void> {
  const hashed = await hashPassword(password);
  db()
    .prepare("UPDATE users SET password = ?, password_login_enabled = 1 WHERE id = ?")
    .run(hashed, userId);
}

/** Used only by the account-creation path, to produce the unreachable hash. */
export async function unreachablePasswordHash(): Promise<string> {
  return hashPassword(randomBytes(32).toString("base64url"));
}
