import type { OAuthProviderId } from "./providers";

export type OAuthIntent = "signin" | "link";

export type OAuthTransaction = {
  provider: OAuthProviderId;
  state: string;
  nonce?: string | null;
  code_verifier?: string | null;
  redirect_uri: string;
  user_id?: string | null;
  return_to?: string | null;
  intent: OAuthIntent;
  createdAt: string;
  expiresAt: string;
};

export function migrateOAuth(db: { exec: (sql: string) => void }) {
  db.exec(`CREATE TABLE IF NOT EXISTS oauth_transactions (state TEXT PRIMARY KEY);`);
}
