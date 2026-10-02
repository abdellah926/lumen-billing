import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { listIdentities } from "@/lib/oauth/identities";
import { publicProviders } from "@/lib/oauth/providers";
import { hasPassword } from "@/lib/password-state";
import { ProviderButtons, OAuthErrorNotice } from "@/components/auth/ProviderButtons";
import { DisconnectProviderButton } from "@/components/account/DisconnectProviderButton";
import { pageMetadata } from "@/lib/seo";
import { Eyebrow } from "@/components/ui/Button";

export const metadata = pageMetadata({
  title: "Account Connections",
  description: "Sign-in providers and apps connected to your Lumen account.",
  path: "/account/connections",
  noIndex: true,
});

/**
 * The one place a provider can be attached to an account.
 *
 * Connecting here is deliberately a separate, signed-in action rather than something that
 * happens as a side effect of signing in with a matching address. That separation is the
 * whole point: the session proves who is at the keyboard, so the provider is bound to the
 * account in front of them and not to whoever happens to hold that email address.
 */
export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?returnTo=/account/connections");

  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const connected = listIdentities(user.id);
  const byProvider = new Map(connected.map((i) => [i.provider, i]));
  const providers = publicProviders();
  const linkable = providers.filter((p) => !byProvider.has(p.id) && p.configured);
  const passwordCapable = hasPassword(user.id);

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8">
      <Eyebrow>Account</Eyebrow>
      <h1 className="text-h1 mt-5 font-bold">Connections.</h1>
      <p className="text-mist mt-4 max-w-prose text-[15px] leading-relaxed">
        Sign in with more than one method, so a lost password or a locked provider is never
        the reason you cannot reach your library. Connecting a provider here attaches it to
        this account — we never attach one automatically just because an email address
        matched.
      </p>

      <OAuthErrorNotice code={first(params.oauth_error)} providerId={first(params.oauth_provider)} />

      <section className="mt-10">
        <h2 className="text-mono-caps text-slate">Connected providers</h2>

        {connected.length === 0 ? (
          <p className="text-slate mt-4 text-[14px]">
            Nothing connected yet. You sign in with an email address and password.
          </p>
        ) : (
          <ul className="mt-4 grid gap-2.5">
            {connected.map((identity) => {
              const label = providers.find((p) => p.id === identity.provider)?.label ?? identity.provider;
              return (
                <li
                  key={identity.id}
                  className="border-obsidian-700 bg-obsidian-900/40 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-md)] border p-4"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[15px] font-medium">
                      {label}
                      <Check className="text-acid-500 size-4 shrink-0" aria-hidden="true" />
                    </p>
                    <p className="text-slate mt-1 truncate text-[13px]">
                      {identity.email_at_provider
                        ? identity.email_at_provider
                        : "No email address shared by this provider"}
                      {identity.email_verified ? " · verified" : ""}
                    </p>
                  </div>
                  <DisconnectProviderButton provider={identity.provider} label={label} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!passwordCapable && (
        <p className="border-err-500/40 bg-err-500/8 text-chalk mt-6 rounded-[var(--radius-md)] border p-4 text-[13px] leading-relaxed">
          This account has no password, so a provider is currently your only way in. Connect
          a second one, or set a password, before disconnecting anything.
        </p>
      )}

      <section className="mt-10">
        <h2 className="text-mono-caps text-slate">Add a provider</h2>
        {linkable.length === 0 ? (
          <p className="text-slate mt-4 text-[14px]">
            No further providers are available on this site.
          </p>
        ) : (
          <div className="border-obsidian-700 bg-obsidian-900/60 elev-2 mt-4 rounded-[var(--radius-lg)] border p-6">
            <ProviderButtons intent="link" returnTo="/account/connections" />
          </div>
        )}
      </section>
    </div>
  );
}
