"use client";

import { useActionState } from "react";
import { Loader2, Unlink } from "lucide-react";
import { disconnectProviderAction, type DisconnectState } from "@/lib/actions/oauth";

const INITIAL: DisconnectState = {};

/**
 * Disconnect control for one provider identity.
 *
 * A client component only because `useActionState` needs one; the mutation itself is a
 * server action, so the button carries no capability of its own and the row is selected by
 * the signed-in account rather than by anything this component sends.
 */
export function DisconnectProviderButton({ provider, label }: { provider: string; label: string }) {
  const [state, formAction, pending] = useActionState(disconnectProviderAction, INITIAL);

  return (
    <form action={formAction} className="flex items-center gap-3">
      <input type="hidden" name="provider" value={provider} />
      <button
        type="submit"
        disabled={pending}
        className="border-obsidian-600 text-slate hover:border-err-500/60 hover:text-err-500 focus-visible:border-err-500 flex h-9 items-center gap-2 rounded-[var(--radius-md)] border px-3 text-[13px] transition-colors disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Unlink className="size-3.5" aria-hidden="true" />
        )}
        Disconnect
      </button>
      <span className="sr-only">Disconnect {label}</span>
      {state.error && (
        <span role="alert" className="text-err-500 text-[12px]">
          {state.error}
        </span>
      )}
    </form>
  );
}
