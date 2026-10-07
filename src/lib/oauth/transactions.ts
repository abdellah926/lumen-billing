import type { OAuthProviderId } from "./providers";
import type { OAuthIntent, OAuthTransaction } from "./schema";

export type { OAuthTransaction } from "./schema";

const map = new Map<string, OAuthTransaction>();

export function createTransaction(input: {
  provider: OAuthProviderId;
  intent: OAuthIntent;
  redirectUri: string;
  codeVerifier?: string | null;
  nonce?: string | null;
  userId?: string | null;
  returnTo?: string | null;
  state?: string;
}): OAuthTransaction {
  const state = input.state ?? `state_${Math.random().toString(36).slice(2)}`;
  const now = new Date();
  const tx: OAuthTransaction = {
    provider: input.provider,
    state,
    nonce: input.nonce ?? null,
    code_verifier: input.codeVerifier ?? null,
    redirect_uri: input.redirectUri,
    user_id: input.userId ?? null,
    return_to: input.returnTo ?? null,
    intent: input.intent,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
  };
  map.set(state, tx);
  return tx;
}

export function consumeTransaction(state: string): OAuthTransaction | undefined {
  const tx = map.get(state);
  if (tx) map.delete(state);
  return tx;
}

export function safeReturnTo(value?: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, "https://example.com");
    return url.pathname.startsWith("/") ? url.pathname : null;
  } catch {
    return null;
  }
}
