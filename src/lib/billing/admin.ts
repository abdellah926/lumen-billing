import "server-only";

import { db } from "@/lib/db";
import { currentUser, type User } from "@/lib/auth";

/**
 * Admin authorization.
 *
 * Deliberately a separate module rather than a branch inside `auth.ts`: the existing
 * `requireUser` throws a bare "UNAUTHENTICATED" string that routes translate into a redirect,
 * and an admin check must not be mistaken for that. A non-admin hitting an admin surface is
 * not an unauthenticated visitor — it is someone who is known and still refused, and the two
 * deserve different handling so a bug cannot downgrade an admin page into a login redirect.
 *
 * The flag is a column rather than a role table because there is exactly one question to ask:
 * may this account see and change the deployment's configuration.
 */

export class NotAnAdmin extends Error {
  constructor() {
    super("This account is not an administrator.");
    this.name = "NotAnAdmin";
  }
}

export function isAdmin(userId: string): boolean {
  const row = db()
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .get(userId) as { is_admin: number | null } | undefined;
  return Number(row?.is_admin ?? 0) === 1;
}

export async function requireAdmin(): Promise<User> {
  const user = await currentUser();
  // Checked in this order so an anonymous visitor is reported as anonymous rather than as a
  // rejected admin, which would leak whether the account exists.
  if (!user) throw new Error("UNAUTHENTICATED");
  if (!isAdmin(user.id)) throw new NotAnAdmin();
  return user;
}

export function setAdmin(userId: string, admin: boolean): void {
  db()
    .prepare("UPDATE users SET is_admin = ? WHERE id = ?")
    .run(admin ? 1 : 0, userId);
}
