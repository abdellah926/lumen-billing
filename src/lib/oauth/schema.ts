import type { DatabaseSync } from "node:sqlite";
import { addColumnIfMissing } from "@/lib/billing/schema";

/**
 * OAuth and Canva schema.
 *
 * The important decision here is that a login identity and a Canva connection are
 * different things stored in different tables, and neither is bolted onto `users`.
 *
 * A login identity answers "who is this person?". A Canva connection answers "which
 * Canva account may I act on behalf of, and with what permission?". Collapsing them
 * would mean that disconnecting Canva also removes someone's only way to sign in, and
 * that reading someone's library to grant a provider access happens as a side effect of
 * them signing in. Keeping them apart means the Canva token is only ever read by the
 * transfer route, and only after an explicit, re-authorised user action.
 *
 * Second decision: `oauth_transactions` is a table, not a cookie. The authorization
 * request carries a `state` that the callback has to match. Storing the state in a
 * cookie and comparing it in the callback is the textbook approach, but the table gives
 * us two things a cookie cannot: the transaction can name the *intent* (`signin` versus
 * `link`), so a callback cannot be turned into an account-link by editing a cookie; and
 * the row is deleted on use, so replaying a captured callback URL fails instead of
 * logging someone in a second time.
 *
 * The migration is additive and idempotent, matching `migrateBilling`.
 */

export type OAuthIntent = "signin" | "link";

/** Canva transfer modes, which are genuinely different operations. */
export type CanvaTransferMode = "layers" | "flat";

/**
 * Transfer states. `flat` and `layers` diverge only at the end: both upload the asset,
 * but `layers` runs the Magic Layers job that splits the image into editable elements
 * and `flat` calls Create design with the asset id, which costs no AI credits but gives
 * a single movable layer. The distinction is stored rather than inferred so a retry
 * resumes the same operation it started.
 */
export type CanvaTransferState =
  | "pending"
  | "uploading"
  | "running"
  | "success"
  | "failed";

export function migrateOAuth(db: DatabaseSync): void {
  db.exec(`
    -- One row per (provider, provider account). UNIQUE is what makes signing in
    -- idempotent and stops two accounts claiming the same upstream identity.
    CREATE TABLE IF NOT EXISTS oauth_identities (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider            TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      email_at_provider   TEXT,
      -- Whether the provider asserts this email is verified. This is recorded, never
      -- inferred: a provider that says nothing about verification must not be treated
      -- as having verified it.
      email_verified      INTEGER NOT NULL DEFAULT 0,
      display_name        TEXT,
      linked_at           TEXT NOT NULL,
      UNIQUE(provider, provider_account_id)
    );
    CREATE INDEX IF NOT EXISTS idx_identities_user ON oauth_identities(user_id);

    -- Server-side authorization-request state. Consumed exactly once.
    CREATE TABLE IF NOT EXISTS oauth_transactions (
      state         TEXT PRIMARY KEY,
      provider      TEXT NOT NULL,
      code_verifier TEXT,
      nonce         TEXT,
      redirect_uri  TEXT NOT NULL,
      intent        TEXT NOT NULL,
      -- Set only for intent='link', so a link callback is meaningless without an
      -- already-authenticated owner.
      user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
      return_to     TEXT,
      created_at    TEXT NOT NULL,
      expires_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_expires ON oauth_transactions(expires_at);

    -- Canva API tokens. Separate from login identities, and encrypted at rest: Canva's
    -- own developer guidance is explicit that a token should not be stored in the clear,
    -- because holding one is holding someone's ability to act in their account.
    CREATE TABLE IF NOT EXISTS canva_connections (
      user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      access_token_enc  TEXT NOT NULL,
      refresh_token_enc TEXT,
      expires_at        TEXT,
      scope             TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );

    -- Async Canva import jobs. UNIQUE(user_id, library_item_id) so a double-clicked
    -- button resumes one job instead of creating two designs in the user's Canva.
    CREATE TABLE IF NOT EXISTS canva_transfers (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      library_item_id TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
      mode            TEXT NOT NULL,
      asset_id        TEXT,
      canva_job_id    TEXT,
      design_id       TEXT,
      edit_url        TEXT,
      state           TEXT NOT NULL,
      error           TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      UNIQUE(user_id, library_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_transfers_user ON canva_transfers(user_id, updated_at DESC);
  `);

  // Whether this account can be signed into with a password.
  //
  // An OAuth-created account has a well-formed but unreachable password hash, so the
  // column is the only honest way to answer "can this person still get in with a
  // password?". It matters at exactly one moment: refusing to disconnect the last provider
  // identity of an account that has no password, which would otherwise lock someone out
  // permanently with no recovery path.
  addColumnIfMissing(db, "users", "password_login_enabled", "INTEGER NOT NULL DEFAULT 1");
}
