import "server-only";

import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { OAuthIntent } from "./schema";
import type { OAuthProviderId } from "./providers";

/**
 * Server-side state for an in-flight authorization request.
 *
 * Ten minutes is generous for a redirect to a provider, a consent screen and a redirect
 * back. An authorization code is single-use and short-lived at the provider anyway, so a
 * longer window here would only widen the replay surface without making the flow work.
 */
const TRANSACTION_TTL_MS = 10 * 60_000;

export type OAuthTransaction = {
  state: string;
  provider: OAuthProviderId;
  code_verifier: string | null;
  nonce: string | null;
  redirect_uri: string;
  intent: OAuthIntent;
  user_id: string | null;
  return_to: string | null;
  created_at: string;
  expires_at: string;
};

export function createTransaction(input: {
  provider: OAuthProviderId;
  intent: OAuthIntent;
  redirectUri: string;
  codeVerifier: string | null;
  nonce: string | null;
  userId?: string;
  returnTo?: string;
}): string {
  purgeExpiredTransactions();

  const state = randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + TRANSACTION_TTL_MS);

  // Sanitised here rather than only at the redirect, so the table never holds a hostile value
  // and the guarantee does not depend on every future caller remembering to check. `flow.ts`
  // already filters it; a second cheap check at the write point is the belt to that braces.
  const returnTo = safeReturnTo(input.returnTo);

  db()
    .prepare(
      `INSERT INTO oauth_transactions
         (state, provider, code_verifier, nonce, redirect_uri, intent, user_id, return_to, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      state,
      input.provider,
      input.codeVerifier,
      input.nonce,
      input.redirectUri,
      input.intent,
      input.userId ?? null,
      returnTo,
      now.toISOString(),
      expires.toISOString(),
    );

  return state;
}

/**
 * Reads a transaction and deletes it in the same breath.
 *
 * Deleting on read is what makes the callback single-use. If the row survived, anyone who
 * could observe a callback URL — a shared device history, a proxy log, a Referer header —
 * could replay it, and the second attempt would sign in again on a fresh cookie. Consuming
 * it means the replay finds nothing.
 *
 * The delete is conditional on the row still being the one we read, so two simultaneous
 * callbacks with the same state cannot both succeed: the loser sees zero rows changed and
 * is treated as a replay.
 */
export function consumeTransaction(state: string): OAuthTransaction | undefined {
  const conn = db();
  const row = conn
    .prepare("SELECT * FROM oauth_transactions WHERE state = ?")
    .get(state) as OAuthTransaction | undefined;
  if (!row) return undefined;

  const del = conn.prepare("DELETE FROM oauth_transactions WHERE state = ?").run(state);
  if (Number(del.changes) === 0) return undefined;

  if (new Date(row.expires_at).getTime() <= Date.now()) return undefined;
  return row;
}

export function purgeExpiredTransactions(): void {
  db()
    .prepare("DELETE FROM oauth_transactions WHERE expires_at < ?")
    .run(new Date().toISOString());
}

/**
 * Only same-site absolute paths are accepted as a post-login destination.
 *
 * `returnTo` reaches us from a query string, so an unchecked value would turn the login
 * flow into an open redirect: an attacker sends a victim to
 * `/api/auth/google/start?returnTo=https://evil.example` and the app helpfully bounces
 * them there immediately after a successful sign-in, with the login looking legitimate.
 */
export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null; // protocol-relative, i.e. //evil.example
  if (value.includes("\\")) return null;
  return value;
}
