import Link from "next/link";
import { KeyRound } from "lucide-react";
import { enabledProviders, OAUTH_PROVIDERS, type PublicProvider } from "@/lib/oauth/providers";

/** Resolves a provider id from the URL back to its display label, defensively. */
function providerLabel(id: string): string {
  return Object.hasOwn(OAUTH_PROVIDERS, id) ? OAUTH_PROVIDERS[id as keyof typeof OAUTH_PROVIDERS].label : "that provider";
}

/**
 * Sign-in buttons for the configured providers.
 *
 * A plain anchor, not a form post and not a client component. The whole flow is a
 * redirect to the provider and back, so the browser can do it directly and the button
 * keeps working with JavaScript unavailable — which also means there is no handler to get
 * wrong and no token to pass through client code.
 *
 * When nothing is configured this renders nothing at all. Not a disabled row, not a
 * "coming soon" label: the brief is explicit that an unconfigured provider must not look
 * available, and a greyed-out button still reads as a promise the app has not kept.
 */
export function ProviderButtons({
  intent = "signin",
  returnTo,
}: {
  intent?: "signin" | "link";
  returnTo?: string;
} = {}) {
  const providers = enabledProviders();
  if (providers.length === 0) return null;

  const qs = new URLSearchParams();
  if (intent === "link") qs.set("intent", "link");
  if (returnTo) qs.set("returnTo", returnTo);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";

  return (
    <div className="mt-7">
      <div className="flex items-center gap-4" aria-hidden="true">
        <span className="border-obsidian-700 h-px flex-1" />
        <span className="text-slate text-[11px] tracking-[0.14em] uppercase">
          {intent === "link" ? "Or connect" : "Or continue with"}
        </span>
        <span className="border-obsidian-700 h-px flex-1" />
      </div>

      <ul className="mt-5 grid gap-2.5">
        {providers.map((p) => (
          <li key={p.id}>
            <ProviderLink provider={p} suffix={suffix} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProviderLink({ provider, suffix }: { provider: PublicProvider; suffix: string }) {
  return (
    <Link
      href={`/api/auth/${provider.id}/start${suffix}`}
      className="border-obsidian-600 bg-obsidian-950/60 hover:border-acid-500/70 hover:bg-obsidian-900 focus-visible:border-acid-500 flex h-12 w-full items-center justify-center gap-2.5 rounded-[var(--radius-md)] border text-[14px] font-medium transition-colors"
    >
      <KeyRound className="text-slate size-4 shrink-0" aria-hidden="true" />
      Continue with {provider.label}
    </Link>
  );
}

/**
 * The finite vocabulary of provider failures, turned into words a person can act on.
 *
 * The URL carries only a slug and a provider id; the sentences live here. That keeps
 * browser history, `Referer` headers and proxy logs free of anything that names a provider
 * or an account, and it means an unrecognised slug falls back to something neutral rather
 * than reflecting attacker-influenced input back into the page.
 */
const MESSAGES: Record<string, (provider: string) => string> = {
  "unknown-provider": () => "That sign-in provider does not exist.",
  "missing-state": () => "That sign-in could not be verified. Please try again.",
  "sign-in-expired-or-already-used": () =>
    "That sign-in link has expired or was already used. Please start again.",
  "sign-in-before-connecting-a-provider": () =>
    "Sign in first, then connect the provider from your account settings.",
  "provider-not-configured": () => "That provider is not set up on this site.",
  "account-exists": (p) =>
    `An account already uses that email address, so we did not sign you in from ${p}. Sign in with your password and connect ${p} from your account settings.`,
  "email-not-verified": (p) =>
    `An account already uses that email address and ${p} did not confirm it is verified, so we did not connect it automatically. Sign in with your password, then connect ${p} from your account settings.`,
  "provider-no-email": (p) =>
    `${p} did not share an email address for this account, so there was nothing safe to create an account from. Sign up with an email address and password instead, then connect ${p} from your account settings.`,
  "provider-no-id": (p) =>
    `${p} did not return an account identifier, so this sign-in could not be completed.`,
  "identity-in-use-elsewhere": (p) =>
    `That ${p} account is already connected to a different Lumen account.`,
};

export function OAuthErrorNotice({
  code,
  providerId,
}: {
  code?: string;
  providerId?: string;
}) {
  if (!code) return null;
  const render = Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : undefined;
  const label = providerId ? providerLabel(providerId) : "that provider";
  const message = render
    ? render(label)
    : "That sign-in could not be completed. Please try again.";

  return (
    <div
      role="alert"
      className="border-err-500/40 bg-err-500/8 rounded-[var(--radius-md)] border p-4"
    >
      <p className="text-[13px] leading-relaxed text-chalk">{message}</p>
    </div>
  );
}
