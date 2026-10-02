"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { deleteIdentity, getIdentity, listIdentities } from "@/lib/oauth/identities";
import { hasPassword } from "@/lib/password-state";
import { OAUTH_PROVIDERS, isOAuthProviderId } from "@/lib/oauth/providers";

export type DisconnectState = { error?: string; ok?: boolean };

/**
 * Removes a provider identity from the current account.
 *
 * Guarded twice over: the row is selected by `user_id AND provider`, so a person cannot
 * disconnect somebody else's identity by guessing an id, and an unlinked provider that is
 * merely left over is reported as "not connected" rather than succeeding quietly.
 *
 * Disconnecting removes the ability to *sign in* with that provider, which is the
 * consequence worth being careful about: someone whose only route in is a provider they
 * just removed has locked themselves out. The UI says so before they press the button, and
 * an account with no password cannot be recovered that way at all — so it refuses when
 * that would be true.
 */
export async function disconnectProviderAction(
  _prev: DisconnectState,
  formData: FormData,
): Promise<DisconnectState> {
  const user = await requireUser();

  const provider = String(formData.get("provider") ?? "");
  if (!isOAuthProviderId(provider)) return { error: "Unknown provider." };

  const existing = getIdentity(user.id, provider);
  if (!existing) return { error: "That provider is not connected to this account." };

  // An account created by a provider has no password, so if this is its only identity
  // there would be no way back in. Refuse rather than let someone lock themselves out.
  if (listIdentities(user.id).length === 1 && !hasPassword(user.id)) {
    return {
      error:
        "This is the only way to sign in to this account. Add a password or connect " +
        "another provider before disconnecting it.",
    };
  }

  deleteIdentity(user.id, provider);
  revalidatePath("/account/connections");
  return { ok: true };
}

export function providerLabel(id: string): string {
  return isOAuthProviderId(id) ? OAUTH_PROVIDERS[id].label : id;
}
