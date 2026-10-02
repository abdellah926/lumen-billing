import "server-only";

import {
  ClientSecretPost,
  discovery,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  calculatePKCECodeChallenge,
  fetchUserInfo,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  skipSubjectCheck,
  type Configuration,
} from "openid-client";

import {
  OAUTH_PROVIDERS,
  isConfigured,
  type OAuthProviderId,
} from "./providers";
import { createTransaction, safeReturnTo, type OAuthTransaction } from "./transactions";
import type { OAuthIntent } from "./schema";
import type { ExternalProfile } from "./resolve";

/**
 * The OAuth flow itself, kept apart from the routes so that "start", "callback" and the
 * profile normalisation stay independently readable.
 *
 * The three secrets of the authorization-code flow are each held in a specific place, and
 * the separation matters:
 *
 *   - `state` is a server-side row key. It proves the callback belongs to a request this
 *     app started, and it is consumed on read so a captured callback URL cannot be replayed.
 *   - `code_verifier` is in that same row and is only ever sent to the token endpoint,
 *     which is what PKCE is for: a code intercepted in a browser history or a proxy log
 *     is useless without it.
 *   - `client_secret` stays here. It is used for the token exchange and for nothing else,
 *     and it is never placed in a URL, a cookie, or a rendered page.
 */

export class OAuthNotConfigured extends Error {}
export class OAuthCallbackError extends Error {}

/** Discovery does a network round-trip; caching it keeps the sign-in page fast. */
const configCache = new Map<OAuthProviderId, Promise<Configuration>>();

function requireConfigured(id: OAuthProviderId) {
  const p = OAUTH_PROVIDERS[id];
  if (!isConfigured(p)) throw new OAuthNotConfigured(`${id} is not configured`);
  return {
    provider: p,
    clientId: process.env[p.env.clientId]!.trim(),
    clientSecret: process.env[p.env.clientSecret]!.trim(),
  };
}

async function configuration(id: OAuthProviderId): Promise<Configuration> {
  const cached = configCache.get(id);
  if (cached) return cached;

  const { provider, clientId, clientSecret } = requireConfigured(id);

  const built = discovery(
    new URL(provider.issuer),
    clientId,
    {
      // Declared explicitly rather than left to the discovery document, so a tampered or
      // stale metadata document cannot silently redirect a sign-in to another host.
      issuer: provider.issuer,
      authorization_endpoint: provider.authorizationEndpoint,
      token_endpoint: provider.tokenEndpoint,
      ...(provider.userinfoEndpoint ? { userinfo_endpoint: provider.userinfoEndpoint } : {}),
    },
    // SecretPost rather than the Basic default: Google and GitHub both accept it, and it
    // avoids a base64 credential in an outbound header that some proxies log.
    ClientSecretPost(clientSecret),
    { algorithm: provider.profile === "oidc" ? "oidc" : "oauth2" },
  ).catch((err) => {
    // A failed discovery must not become a permanently cached rejection.
    configCache.delete(id);
    throw err;
  });

  configCache.set(id, built);
  return built;
}

export function callbackPath(id: OAuthProviderId): string {
  return `/api/auth/${id}/callback`;
}

export function redirectUriFor(origin: string, id: OAuthProviderId): string {
  return new URL(callbackPath(id), origin).toString();
}

export type AuthorizationRequest = { url: string; state: string };

export async function beginAuthorization(input: {
  provider: OAuthProviderId;
  origin: string;
  intent: OAuthIntent;
  userId?: string;
  returnTo?: string | null;
}): Promise<AuthorizationRequest> {
  const { provider, clientId } = requireConfigured(input.provider);
  const config = await configuration(input.provider);

  const state = randomState();
  const nonce = randomNonce();
  // PKCE on every provider, including the ones that do not require it. The ones that
  // ignore an unknown parameter cost nothing, and the ones that honour it are protected.
  const codeVerifier = randomPKCECodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const redirectUri = redirectUriFor(input.origin, input.provider);

  createTransaction({
    provider: input.provider,
    intent: input.intent,
    redirectUri,
    codeVerifier,
    nonce,
    userId: input.userId,
    returnTo: safeReturnTo(input.returnTo) ?? undefined,
  });

  const params: Record<string, string> = {
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: provider.scopes.join(" "),
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    ...provider.authorizationParams,
  };

  return { url: buildAuthorizationUrl(config, params).toString(), state };
}

export type ExchangedTokens = { accessToken: string };

export async function exchangeCode(input: {
  transaction: OAuthTransaction;
  callbackUrl: URL;
}): Promise<ExchangedTokens> {
  const config = await configuration(input.transaction.provider);

  const tokens = await authorizationCodeGrant(
    config,
    input.callbackUrl,
    {
      expectedState: input.transaction.state,
      expectedNonce: input.transaction.nonce ?? undefined,
      pkceCodeVerifier: input.transaction.code_verifier ?? undefined,
    },
    {
      redirect_uri: input.transaction.redirect_uri,
    },
  ).catch((err) => {
    throw new OAuthCallbackError(
      `Token exchange failed for ${input.transaction.provider}: ${err?.message ?? "unknown"}`,
    );
  });

  const accessToken = tokens.access_token;
  if (!accessToken) throw new OAuthCallbackError("Provider returned no access token");
  return { accessToken };
}

/* ------------------------------------------------------------ profile fetchers */

async function getJson(url: string, accessToken: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "user-agent": "lumen-oauth",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new OAuthCallbackError(`Profile request failed with ${res.status}`);
  }
  return res.json();
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function googleProfile(config: Configuration, accessToken: string): Promise<ExternalProfile> {
  // The userinfo endpoint, not the ID token. openid-client v6 does not validate ID token
  // signatures unless explicitly enabled, and reading claims from an unvalidated token
  // would mean trusting a payload we never checked. This is a signed, authenticated GET.
  const claims = await fetchUserInfo(config, accessToken, skipSubjectCheck).catch(() => {
    // A transient userinfo failure should not be fatal; fall through to a direct call.
    return null;
  });

  if (claims) {
    return {
      providerAccountId: str(claims.sub) ?? "",
      email: str(claims.email),
      emailVerified: claims.email_verified === true,
      name: str(claims.name),
    };
  }

  const discovered = config.serverMetadata().userinfo_endpoint;
  const raw = (await getJson(
    discovered?.toString() ?? "https://openidconnect.googleapis.com/v1/userinfo",
    accessToken,
  )) as Record<string, unknown>;
  return {
    providerAccountId: str(raw.sub) ?? "",
    email: str(raw.email),
    emailVerified: raw.email_verified === true,
    name: str(raw.name),
  };
}

async function discordProfile(accessToken: string): Promise<ExternalProfile> {
  const raw = (await getJson("https://discord.com/api/users/@me", accessToken)) as Record<
    string,
    unknown
  >;
  return {
    providerAccountId: str(raw.id) ?? "",
    email: str(raw.email),
    // Discord does send a real `verified` flag; trust it, and treat absence as false.
    emailVerified: raw.verified === true,
    name: str(raw.global_name) ?? str(raw.username),
  };
}

async function githubProfile(accessToken: string): Promise<ExternalProfile> {
  const raw = (await getJson("https://api.github.com/user", accessToken)) as Record<
    string,
    unknown
  >;

  let email = str(raw.email);
  let emailVerified = false;

  if (!email) {
    // GitHub hides the address on the user endpoint when it is private. The emails
    // endpoint lists it with an explicit verified flag, so use that rather than guessing.
    const list = (await getJson("https://api.github.com/user/emails", accessToken)) as {
      email?: unknown;
      primary?: unknown;
      verified?: unknown;
    }[];
    if (Array.isArray(list)) {
      const primary = list.find((e) => e?.primary === true && e?.verified === true) ?? null;
      const anyVerified = list.find((e) => e?.verified === true) ?? null;
      const chosen = primary ?? anyVerified;
      email = str(chosen?.email);
      emailVerified = chosen?.verified === true;
    }
  } else {
    // The address on /user is the public one; GitHub has verified it by virtue of it
    // being public, but we still record the claim conservatively as unverified so the
    // strictest branch of the resolver is used for matching.
    emailVerified = false;
  }

  return {
    providerAccountId: str(raw.id) ?? "",
    email,
    emailVerified,
    name: str(raw.name) ?? str(raw.login),
  };
}

async function facebookProfile(accessToken: string): Promise<ExternalProfile> {
  const url = new URL("https://graph.facebook.com/v21.0/me");
  url.searchParams.set("fields", "id,name,email");
  const raw = (await getJson(url.toString(), accessToken)) as Record<string, unknown>;
  return {
    providerAccountId: str(raw.id) ?? "",
    email: str(raw.email),
    // Facebook does not expose a verification flag on these fields. Recording `false` is
    // the point: it means this provider can never satisfy an existing-account match.
    emailVerified: false,
    name: str(raw.name),
  };
}

async function xProfile(accessToken: string): Promise<ExternalProfile> {
  const url = new URL("https://api.twitter.com/2/users/me");
  url.searchParams.set("user.fields", "id,name,username");
  const raw = (await getJson(url.toString(), accessToken)) as {
    data?: Record<string, unknown>;
  };
  const user = raw.data ?? {};
  return {
    providerAccountId: str(user.id) ?? "",
    // API v2 exposes no email on this endpoint at all. That is why X can be linked but
    // never used to create an account; see `emailClaimNote` in providers.ts.
    email: null,
    emailVerified: false,
    name: str(user.name) ?? str(user.username),
  };
}

const PROFILE_FETCHERS: Record<
  OAuthProviderId,
  (config: Configuration, token: string) => Promise<ExternalProfile>
> = {
  google: googleProfile,
  discord: (_config, token) => discordProfile(token),
  github: (_config, token) => githubProfile(token),
  facebook: (_config, token) => facebookProfile(token),
  x: (_config, token) => xProfile(token),
};

export async function fetchProfile(
  id: OAuthProviderId,
  accessToken: string,
): Promise<ExternalProfile> {
  const fetcher = PROFILE_FETCHERS[id];
  if (!fetcher) throw new OAuthCallbackError(`No profile fetcher for ${id}`);
  const profile = await fetcher(await configuration(id), accessToken);

  if (!profile.providerAccountId) {
    throw new OAuthCallbackError(`${id} returned no stable account identifier`);
  }
  return profile;
}

/** Exposed for the callback route so a callback failure cannot leak a raw stack trace. */
export function describeOAuthFailure(err: unknown): { status: number; message: string } {
  if (err instanceof OAuthNotConfigured) return { status: 404, message: err.message };
  if (err instanceof OAuthCallbackError) return { status: 400, message: err.message };
  return { status: 500, message: "The sign-in could not be completed. Please try again." };
}
