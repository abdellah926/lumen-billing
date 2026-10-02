import { NextResponse } from "next/server";
import { createSession, currentUser } from "@/lib/auth";
import { isOAuthProviderId } from "@/lib/oauth/providers";
import {
  exchangeCode,
  fetchProfile,
  describeOAuthFailure,
} from "@/lib/oauth/flow";
import { consumeTransaction } from "@/lib/oauth/transactions";
import {
  identityStore,
  createOAuthUser,
  insertIdentity,
} from "@/lib/oauth/identities";
import {
  resolveExternalIdentity,
  LINK_REFUSAL_SLUGS,
  REJECT_SLUGS,
} from "@/lib/oauth/resolve";
import { authErrorRedirect, authSuccessRedirect, requestOrigin } from "@/lib/oauth/request";

/**
 * Step two: the provider sends the user back, and this decides what that means.
 *
 * The order below is the security argument, and each step is load-bearing:
 *
 *   1. Consume the transaction *first*. A state we do not recognise is either a forged
 *      callback or a replay of a real one, and both are answered the same way: nothing
 *      happens. Consuming before doing any work also means an authorization code is only
 *      ever spent once, whatever else fails afterwards.
 *   2. Check the transaction's provider matches the URL. Without this, a callback
 *      harvested at one provider could be replayed against another, because the state
 *      alone does not say which exchange it was minted for.
 *   3. For a link, re-check the session. It was verified when the flow started, but the
 *      user may have signed out during the round-trip, and the transaction must not be
 *      able to attach an identity to an account nobody is currently using.
 *   4. Only then exchange the code and ask who the person is.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const origin = await requestOrigin();
  const fail = (slug: string) =>
    NextResponse.redirect(authErrorRedirect(origin, "login", slug, provider));

  if (!isOAuthProviderId(provider)) {
    return NextResponse.redirect(authErrorRedirect(origin, "login", "unknown-provider"));
  }

  const url = new URL(request.url);

  /* ------------------------------------------------------------- 1. consume state */
  const state = url.searchParams.get("state");
  if (!state) return fail("missing-state");

  const transaction = consumeTransaction(state);
  if (!transaction) {
    // Replayed, or never issued. Indistinguishable on purpose: telling the two apart
    // would tell an attacker whether their injected callback was well-formed.
    return fail("sign-in-expired-or-already-used");
  }

  /* --------------------------------------------------------- 2. provider agreement */
  if (transaction.provider !== provider) return fail("sign-in-expired-or-already-used");

  /* ------------------------------------------------------------ 3. link still valid */
  const signedIn = await currentUser();
  if (transaction.intent === "link") {
    if (!signedIn || signedIn.id !== transaction.user_id) {
      return fail("sign-in-before-connecting-a-provider");
    }
  }

  /* ------------------------------------------------------ 4. exchange and identify */
  try {
    const { accessToken } = await exchangeCode({ transaction, callbackUrl: url });
    const profile = await fetchProfile(provider, accessToken);

    const decision = resolveExternalIdentity(
      {
        provider,
        profile,
        intent: transaction.intent,
        signedInUserId: signedIn?.id,
      },
      identityStore,
    );

    switch (decision.kind) {
      case "signin": {
        await createSession(decision.userId);
        return NextResponse.redirect(authSuccessRedirect(origin, "signed-in", transaction.return_to));
      }

      case "create": {
        let userId: string;
        try {
          const user = await createOAuthUser(decision.email, decision.name);
          userId = user.id;
          insertIdentity(userId, provider, profile);
        } catch (err) {
          // Two people can complete a first-time sign-in for the same address at the same
          // moment. The UNIQUE index settles it, and the loser is told to sign in rather
          // than being shown a crash.
          if (/UNIQUE|constraint/i.test(err instanceof Error ? err.message : "")) {
            return fail("account-already-exists-sign-in-instead");
          }
          throw err;
        }
        await createSession(userId);
        return NextResponse.redirect(authSuccessRedirect(origin, "created", transaction.return_to));
      }

      case "link": {
        // The account is the signed-in one, never the one the email belongs to. This is
        // what makes linking safe when the two addresses differ.
        insertIdentity(decision.userId, provider, profile);
        return NextResponse.redirect(authSuccessRedirect(origin, "linked", transaction.return_to));
      }

      case "link_required": {
        return fail(LINK_REFUSAL_SLUGS[decision.reason]);
      }

      case "reject": {
        return fail(REJECT_SLUGS[decision.reason]);
      }
    }
  } catch (err) {
    const { message } = describeOAuthFailure(err);
    console.error(`[oauth] callback ${provider} failed:`, err);
    return fail(message);
  }
}
