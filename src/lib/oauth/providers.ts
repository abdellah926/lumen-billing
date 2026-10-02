/**
 * The five sign-in providers, described as data.
 *
 * This module is deliberately free of `node:crypto`, of `openid-client`, and of anything
 * else server-only, because the same registry is imported by the server component that
 * renders the buttons. Keeping it pure is what lets a provider's *existence* be decided
 * from environment variables while its *credentials* stay on the server: the render path
 * reads `process.env` on the server and passes only `id`, `label` and `configured` down
 * to the client, so no secret can reach a browser bundle.
 *
 * The endpoints are written out rather than discovered, because each provider's OAuth
 * doc publishes them and discovery at request time would put a network round-trip in
 * the middle of rendering a sign-in page. `openid-client` still verifies the issuer
 * against this metadata, so a typo fails loudly at startup instead of silently
 * redirecting users to a lookalike host.
 *
 * Official endpoint references, per provider:
 *   Google   https://developers.google.com/identity/protocols/oauth2
 *   X        https://docs.x.com/x-api/users/authentication
 *   Discord  https://discord.com/developers/docs/topics/oauth2
 *   GitHub   https://docs.github.com/apps/oauth-apps
 *   Facebook https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/
 */

export type OAuthProviderId = "google" | "x" | "facebook" | "discord" | "github";

export type ProfileShape = "oidc" | "graph" | "discord" | "github" | "x";

export type OAuthProvider = {
  id: OAuthProviderId;
  label: string;
  /** Short word used in consent copy, e.g. "Google reports a verified email address". */
  emailClaimNote: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
  /**
   * Only Google speaks OpenID Connect properly here. The rest are plain OAuth 2.0, so
   * the profile is fetched from a provider API after the token exchange rather than
   * read from an ID token. Getting this wrong is the difference between trusting a
   * signed assertion and trusting an unsigned JSON response.
   */
  profile: ProfileShape;
  userinfoEndpoint?: string;
  /** Extra query the authorization endpoint needs; X requires forcing a fresh login consent. */
  authorizationParams?: Record<string, string>;
  env: { clientId: string; clientSecret: string };
};

export const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProvider> = {
  google: {
    id: "google",
    label: "Google",
    emailClaimNote: "Google asserts the email address is verified",
    issuer: "https://accounts.google.com",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "profile"],
    profile: "oidc",
    userinfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
    // Without this Google silently reuses a previous consent and skips the consent
    // screen, which makes "sign in with Google" appear to do nothing on a retry.
    authorizationParams: { prompt: "select_account" },
    env: { clientId: "OAUTH_GOOGLE_ID", clientSecret: "OAUTH_GOOGLE_SECRET" },
  },

  x: {
    id: "x",
    label: "X",
    // X is the awkward one: it returns an email only when the account has one that is
    // verified, and it will happily omit it otherwise. `emailClaimNote` is deliberately
    // honest about that so the UI can explain a refusal instead of appearing broken.
    emailClaimNote: "X returns an email only when the account has a verified one",
    issuer: "https://twitter.com",
    authorizationEndpoint: "https://twitter.com/i/oauth2/authorize",
    tokenEndpoint: "https://api.twitter.com/2/oauth2/token",
    scopes: ["users.read", "tweet.read", "offline.access"],
    profile: "x",
    authorizationParams: { force_login: "false" },
    env: { clientId: "OAUTH_X_ID", clientSecret: "OAUTH_X_SECRET" },
  },

  facebook: {
    id: "facebook",
    label: "Facebook",
    // Facebook does not expose a trustworthy "this email is verified" flag through the
    // standard fields, so nothing here may be treated as proof of verification. That is
    // the reason this provider cannot silently adopt an existing account.
    emailClaimNote: "Facebook does not confirm email verification, so it never auto-matches accounts",
    issuer: "https://www.facebook.com",
    authorizationEndpoint: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenEndpoint: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: ["email", "public_profile"],
    profile: "graph",
    userinfoEndpoint: "https://graph.facebook.com/me",
    env: { clientId: "OAUTH_FACEBOOK_ID", clientSecret: "OAUTH_FACEBOOK_SECRET" },
  },

  discord: {
    id: "discord",
    label: "Discord",
    emailClaimNote: "Discord returns a verified flag alongside the email",
    issuer: "https://discord.com",
    authorizationEndpoint: "https://discord.com/oauth2/authorize",
    tokenEndpoint: "https://discord.com/api/oauth2/token",
    scopes: ["identify", "email"],
    profile: "discord",
    userinfoEndpoint: "https://discord.com/api/users/@me",
    env: { clientId: "OAUTH_DISCORD_ID", clientSecret: "OAUTH_DISCORD_SECRET" },
  },

  github: {
    id: "github",
    label: "GitHub",
    emailClaimNote: "GitHub marks each email verified and we read the primary one",
    issuer: "https://github.com",
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    scopes: ["read:user", "user:email"],
    profile: "github",
    userinfoEndpoint: "https://api.github.com/user",
    env: { clientId: "OAUTH_GITHUB_ID", clientSecret: "OAUTH_GITHUB_SECRET" },
  },
};

export const OAUTH_PROVIDER_ORDER: OAuthProviderId[] = [
  "google",
  "github",
  "discord",
  "x",
  "facebook",
];

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return Object.hasOwn(OAUTH_PROVIDERS, value);
}

/**
 * A provider is configured only when both halves of its credential are present.
 *
 * Requiring both matters: with an id but no secret, the sign-in page would render a
 * working-looking button that fails at the token exchange, which is exactly the "button
 * that looks configured but is not" the brief rules out.
 */
export function isConfigured(p: OAuthProvider): boolean {
  const id = process.env[p.env.clientId]?.trim();
  const secret = process.env[p.env.clientSecret]?.trim();
  return Boolean(id && secret);
}

export type PublicProvider = {
  id: OAuthProviderId;
  label: string;
  configured: boolean;
};

/**
 * What the sign-in UI is allowed to know: which providers exist, what they are called,
 * and whether they are usable. Secrets never appear here, and this function is the only
 * thing the login and signup pages are meant to call.
 */
export function publicProviders(): PublicProvider[] {
  return OAUTH_PROVIDER_ORDER.map((id) => {
    const p = OAUTH_PROVIDERS[id];
    return { id, label: p.label, configured: isConfigured(p) };
  });
}

/** Only configured providers get a button. */
export function enabledProviders(): PublicProvider[] {
  return publicProviders().filter((p) => p.configured);
}
