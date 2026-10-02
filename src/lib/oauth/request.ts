import "server-only";

import { headers } from "next/headers";

/**
 * Working out the app's own origin, and building the redirects that depend on it.
 *
 * Kept apart from `flow.ts` so the OAuth logic stays importable without `next/headers`,
 * which is what lets it be exercised outside a running Next server.
 *
 * The redirect URI has to be byte-identical between the authorization request and the
 * token exchange, and it has to be the URL the user's browser actually used, or the
 * provider will reject the callback. That makes this more than a convenience helper:
 * `LUMEN_PUBLIC_ORIGIN` is the escape hatch for deployments where the request's own
 * `Host` is an internal name — behind a tunnel, a reverse proxy or a platform router,
 * `Host` is frequently not the address in the address bar, and a mismatch fails as an
 * opaque "redirect_uri_mismatch" from the provider.
 */
export async function requestOrigin(): Promise<string> {
  const configured = process.env.LUMEN_PUBLIC_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host")?.trim();
  if (!host) return "http://localhost:3000";

  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  return `${proto}://${host}`;
}

/**
 * Errors are shown on a real page rather than as a query string on the sign-in form.
 *
 * Putting a message in the URL would put it in browser history, in `Referer` headers on
 * the next navigation, and in any proxy log along the way. A message that can name a
 * provider has no business being in any of those.
 *
 * So what travels in the URL is a short slug plus the provider id, and the page turns that
 * pair into copy. Two consequences worth keeping: the vocabulary of failures is finite and
 * reviewable, and a slug is never attacker-supplied text reflected back into the page.
 */
export function authErrorRedirect(
  origin: string,
  path: string,
  slug: string,
  provider?: string,
): string {
  const url = new URL(`/${path}`, origin);
  url.searchParams.set("oauth_error", slug);
  if (provider) url.searchParams.set("oauth_provider", provider);
  return url.toString();
}

export type OAuthOutcome = "signed-in" | "created" | "linked";

export function authSuccessRedirect(
  origin: string,
  outcome: OAuthOutcome,
  returnTo?: string | null,
): string {
  const base = outcome === "linked" ? "/account/connections" : "/library";
  const target = returnTo
    ? `${base}${base.includes("?") ? "&" : "?"}next=${encodeURIComponent(returnTo)}`
    : base;
  return new URL(target, origin).toString();
}
