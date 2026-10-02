import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import type { OAuthProviderId } from "./providers";
import type { ExternalProfile, ResolutionStore } from "./resolve";

/**
 * Identity storage for sign-in providers.
 *
 * Note what is *not* here: no token storage. Once a provider has told us who the person
 * is, the access token has done its job and is dropped. Keeping it would mean holding a
 * credential that can act in someone's Google account for as long as the row exists,
 * which is a much larger liability than the convenience of skipping a re-auth.
 *
 * The one exception is Canva, which genuinely needs a retained token to act later. That
 * lives in its own module and its own table, with a separate consent step.
 */

export type OAuthIdentity = {
  id: string;
  user_id: string;
  provider: OAuthProviderId;
  provider_account_id: string;
  email_at_provider: string | null;
  email_verified: number;
  display_name: string | null;
  linked_at: string;
};

/** The store shape `resolveExternalIdentity` expects, backed by real SQL. */
export const identityStore: ResolutionStore = {
  findIdentity(provider, providerAccountId) {
    const row = db()
      .prepare(
        "SELECT user_id FROM oauth_identities WHERE provider = ? AND provider_account_id = ?",
      )
      .get(provider, providerAccountId) as { user_id: string } | undefined;
    return row ? { userId: row.user_id } : undefined;
  },
  findUserByEmail(email) {
    const row = db()
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(email.toLowerCase().trim()) as { id: string } | undefined;
    return row ? { id: row.id } : undefined;
  },
};

export function listIdentities(userId: string): OAuthIdentity[] {
  return db()
    .prepare(
      `SELECT * FROM oauth_identities WHERE user_id = ? ORDER BY linked_at ASC`,
    )
    .all(userId) as OAuthIdentity[];
}

export function getIdentity(userId: string, provider: OAuthProviderId): OAuthIdentity | undefined {
  return db()
    .prepare("SELECT * FROM oauth_identities WHERE user_id = ? AND provider = ?")
    .get(userId, provider) as OAuthIdentity | undefined;
}

export function insertIdentity(userId: string, provider: OAuthProviderId, profile: ExternalProfile) {
  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO oauth_identities
         (id, user_id, provider, provider_account_id, email_at_provider, email_verified, display_name, linked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      provider,
      profile.providerAccountId,
      profile.email,
      profile.emailVerified ? 1 : 0,
      profile.name,
      new Date().toISOString(),
    );
  return id;
}

export function deleteIdentity(userId: string, provider: OAuthProviderId): boolean {
  const res = db()
    .prepare("DELETE FROM oauth_identities WHERE user_id = ? AND provider = ?")
    .run(userId, provider);
  return Number(res.changes) > 0;
}

/**
 * Creates an account for a first-time OAuth sign-in.
 *
 * `users.password` is NOT NULL, but an OAuth account has no password, and inventing a
 * guessable placeholder would quietly open a password login nobody asked for. So the
 * column gets a scrypt hash of 32 random bytes that are then thrown away: the value is
 * well-formed, it can never be matched, and if it is ever read by something expecting a
 * recoverable credential it is already unrecoverable by construction.
 *
 * `password_login_enabled` is then cleared, which is the flag that lets the account page
 * say "add a password" rather than letting somebody disconnect their last way in.
 */
export async function createOAuthUser(email: string, name: string | null): Promise<{
  id: string;
  email: string;
  name: string;
}> {
  const normalised = email.toLowerCase().trim();
  const id = randomBytes(16).toString("hex");
  const displayName = (name?.trim() || normalised.split("@")[0] || "Lumen user").slice(0, 80);
  const unreachable = await hashPassword(randomBytes(32).toString("base64url"));
  const now = new Date().toISOString();

  db()
    .prepare(
      `INSERT INTO users (id, email, name, password, password_login_enabled, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`,
    )
    .run(id, normalised, displayName, unreachable, now);

  return { id, email: normalised, name: displayName };
}
