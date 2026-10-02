import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isOAuthProviderId } from "@/lib/oauth/providers";
import { beginAuthorization, OAuthNotConfigured, describeOAuthFailure } from "@/lib/oauth/flow";
import { authErrorRedirect, requestOrigin } from "@/lib/oauth/request";
import type { OAuthIntent } from "@/lib/oauth/schema";

/**
 * Step one of a provider sign-in or link: send the user to the provider.
 *
 * `intent` is taken from the query string but only "link" is honoured here, and only when
 * a session already exists. That ordering is the security property: the intent is recorded
 * in the transaction row *before* the user leaves, so the callback cannot decide for
 * itself that it was a link. A callback that arrives without a matching row is rejected.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const origin = await requestOrigin();

  if (!isOAuthProviderId(provider)) {
    return NextResponse.redirect(authErrorRedirect(origin, "login", "unknown-provider"));
  }

  const url = new URL(request.url);
  const requestedIntent = url.searchParams.get("intent");
  const intent: OAuthIntent = requestedIntent === "link" ? "link" : "signin";

  // A link must be attached to somebody. Without a session there is no account to attach
  // it to, and treating it as a sign-in would turn "connect provider" into "sign in".
  const user = await currentUser();
  if (intent === "link" && !user) {
    return NextResponse.redirect(
      authErrorRedirect(origin, "login", "sign-in-before-connecting-a-provider"),
    );
  }

  try {
    const { url: authorizeUrl } = await beginAuthorization({
      provider,
      origin,
      intent,
      userId: intent === "link" ? user!.id : undefined,
      returnTo: url.searchParams.get("returnTo"),
    });
    return NextResponse.redirect(authorizeUrl);
  } catch (err) {
    if (err instanceof OAuthNotConfigured) {
      // Nothing was ever configured, so there is no button pointing here. Reaching this
      // means somebody typed the URL, and saying "not configured" is the honest answer.
      return NextResponse.redirect(authErrorRedirect(origin, "login", "provider-not-configured"));
    }
    const { status, message } = describeOAuthFailure(err);
    console.error(`[oauth] start ${provider} failed:`, err);
    return NextResponse.redirect(authErrorRedirect(origin, "login", message), { status });
  }
}
