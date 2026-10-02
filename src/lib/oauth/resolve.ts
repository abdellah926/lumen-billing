import type { OAuthIntent } from "./schema";
import type { OAuthProviderId } from "./providers";

/**
 * Deciding what a successful provider callback means.
 *
 * This file is pure on purpose. The rule the brief sets is the one most likely to be
 * got wrong by accident, so it is expressed as a total function over an abstract store
 * and tested directly, rather than being buried in a route handler where a refactor can
 * quietly reintroduce an auto-link.
 *
 * The rule, in full:
 *
 *   1. A provider identity we have seen before signs its owner in. Idempotent, and the
 *      only path that grants a session without asking anything.
 *   2. A provider identity we have never seen, on an address no account holds, creates
 *      an account. This is the "first OAuth signs you up" behaviour.
 *   3. A provider identity we have never seen, on an address an account *already* holds,
 *      does **not** sign in and does **not** adopt the account. It stops and asks the
 *      person to prove they own the existing account first.
 *
 * Rule 3 is the whole reason this function exists. Same email is not proof of identity.
 * Most large providers treat the address as strong evidence, but not all of them assert
 * that it is verified — Facebook, for one, does not — and a provider that asserts
 * nothing cannot be treated as having verified anything. Adopting an account on an
 * unverified match is account takeover dressed up as convenience, so the code refuses
 * it even in the cases where it would probably have been fine.
 *
 * Linking is a fourth path, reachable only while signed in: a *new* identity is attached
 * to the signed-in account. It never adopts a different account, even when the emails
 * match, because the point is that the session — not the email — is the authorisation.
 */

export type ExternalProfile = {
  providerAccountId: string;
  /** Null when the provider declined to share one. X does this routinely. */
  email: string | null;
  /**
   * Whether the provider asserts the email is verified. `false` covers both "not
   * verified" and "the provider has no opinion", and the distinction is deliberately
   * collapsed: neither may be trusted for matching.
   */
  emailVerified: boolean;
  name: string | null;
};

export type ResolutionStore = {
  findIdentity(
    provider: OAuthProviderId,
    providerAccountId: string,
  ): { userId: string } | undefined;
  findUserByEmail(email: string): { id: string } | undefined;
};

export type LinkRefusalReason =
  /** The provider did not assert the address is verified, so it cannot be matched. */
  | "email_not_verified"
  /** Verified address, but the account already exists and no session proved ownership. */
  | "account_exists";

export type RejectReason =
  | "provider_returned_no_email"
  | "provider_returned_no_id"
  /** The link flow was attempted without a signed-in account to attach to. */
  | "no_signed_in_account"
  /** This provider identity is already attached to a different account. */
  | "identity_belongs_to_another_account";

export type Resolution =
  /** Sign an existing user in via a known identity. */
  | { kind: "signin"; userId: string }
  /** Create a new account, then attach the identity to it. */
  | { kind: "create"; email: string; name: string | null }
  /** Attach a new identity to the already-signed-in account. */
  | { kind: "link"; userId: string; email: string | null; name: string | null }
  /** Stop: an account holds this address but we will not touch it without proof. */
  | { kind: "link_required"; existingUserId: string; reason: LinkRefusalReason }
  /** Stop: nothing safe can be done. */
  | { kind: "reject"; reason: RejectReason };

export type ResolveInput = {
  provider: OAuthProviderId;
  profile: ExternalProfile;
  intent: OAuthIntent;
  /**
   * Who is signed in right now. Present only for `intent: "link"`, which is precisely
   * why the two intents can never be mistaken for one another downstream.
   */
  signedInUserId?: string;
};

function normalise(email: string): string {
  return email.trim().toLowerCase();
}

export function resolveExternalIdentity(
  input: ResolveInput,
  store: ResolutionStore,
): Resolution {
  const { provider, profile, intent, signedInUserId } = input;

  // No stable subject means we cannot bind the account to anything, ever. Refusing here
  // is better than minting a fresh account on every sign-in.
  if (!profile.providerAccountId) return { kind: "reject", reason: "provider_returned_no_id" };

  const known = store.findIdentity(provider, profile.providerAccountId);

  /* ------------------------------------------------------------------- linking */
  if (intent === "link") {
    if (!signedInUserId) return { kind: "reject", reason: "no_signed_in_account" };
    if (known) {
      // Already ours is a no-op; already someone else's is a refusal.
      return known.userId === signedInUserId
        ? { kind: "signin", userId: signedInUserId }
        : { kind: "reject", reason: "identity_belongs_to_another_account" };
    }
    // Linking is authorised by the session, not by the address, so the provider's email
    // is recorded as evidence rather than required as proof. This is what lets X be
    // connected at all: API v2 exposes no email on `/2/users/me`, so X can never create
    // an account, but it can still be linked to an existing one.
    return {
      kind: "link",
      userId: signedInUserId,
      email: profile.email ? normalise(profile.email) : null,
      name: profile.name,
    };
  }

  /* ------------------------------------------------------------------- sign-in */
  if (known) return { kind: "signin", userId: known.userId };

  // `users.email` is NOT NULL UNIQUE, so an account cannot be created without one.
  // X in particular omits the address whenever the account has no verified email.
  if (!profile.email) return { kind: "reject", reason: "provider_returned_no_email" };

  const email = normalise(profile.email);
  const existing = store.findUserByEmail(email);
  if (!existing) return { kind: "create", email, name: profile.name };

  // Same address, no proof. Stop rather than sign in or adopt.
  return {
    kind: "link_required",
    existingUserId: existing.id,
    reason: profile.emailVerified ? "account_exists" : "email_not_verified",
  };
}

/** Human wording for each outcome, kept beside the rules so the two cannot drift. */
export function describeLinkRefusal(reason: LinkRefusalReason): string {
  if (reason === "email_not_verified") {
    return (
      "An account already uses this email address, and this provider did not confirm that the " +
      "address is verified, so we will not connect it automatically. Sign in with your password " +
      "and connect the provider from your account settings."
    );
  }
  return (
    "An account already uses this email address. To be safe we do not sign you in from a " +
    "provider when the account might belong to someone else. Sign in with your password and " +
    "connect the provider from your account settings."
  );
}

/**
 * Short, finite slugs for the outcomes above.
 *
 * A redirect can only carry a slug, never the sentence: whatever goes in the query string
 * ends up in history and in `Referer`. The sentences stay here as the single source of
 * truth, and the UI pairs the slug with the provider label to render them.
 */
export const LINK_REFUSAL_SLUGS: Record<LinkRefusalReason, string> = {
  email_not_verified: "email-not-verified",
  account_exists: "account-exists",
};

export const REJECT_SLUGS: Record<RejectReason, string> = {
  provider_returned_no_email: "provider-no-email",
  provider_returned_no_id: "provider-no-id",
  no_signed_in_account: "sign-in-before-connecting-a-provider",
  identity_belongs_to_another_account: "identity-in-use-elsewhere",
};

export function describeReject(reason: RejectReason, providerLabel: string): string {
  switch (reason) {
    case "provider_returned_no_email":
      return (
        `${providerLabel} did not share an email address for this account, so there is nothing ` +
        `safe to create an account from. Sign up with an email address and password instead, ` +
        `then connect ${providerLabel} from your account settings.`
      );
    case "provider_returned_no_id":
      return `${providerLabel} did not return an account identifier, so this sign-in could not be completed.`;
    case "no_signed_in_account":
      return "You need to be signed in before connecting a provider.";
    case "identity_belongs_to_another_account":
      return `That ${providerLabel} account is already connected to a different Lumen account.`;
  }
}
