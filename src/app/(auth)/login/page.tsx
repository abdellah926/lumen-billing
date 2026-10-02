import { OAuthErrorNotice, ProviderButtons } from "@/components/auth/ProviderButtons";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthShell, loginMetadata, redirectIfSignedIn } from "../AuthShell";

export const metadata = loginMetadata;

/**
 * Which providers appear is decided from environment variables at render time, so this page
 * must never be prerendered. A cached copy would keep showing the provider set from
 * whenever it was built: a button for a provider whose credentials have since been removed,
 * or no button for one that has just been added — the exact "looks available but isn't"
 * outcome the brief rules out. Credentials are usually rotated or added by an operator
 * without a redeploy, so the cache cannot be trusted to be stale for long.
 */
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectIfSignedIn();

  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to Lumen."
      intro="Your library is waiting: everything you have upscaled or downloaded, filed by type and searchable."
    >
      <OAuthErrorNotice code={first(params.oauth_error)} providerId={first(params.oauth_provider)} />
      <AuthForm mode="login" />
      <ProviderButtons returnTo={first(params.returnTo)} />
    </AuthShell>
  );
}
