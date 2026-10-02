import { OAuthErrorNotice, ProviderButtons } from "@/components/auth/ProviderButtons";
import { AuthForm } from "@/components/auth/AuthForm";
import { AuthShell, redirectIfSignedIn, signupMetadata } from "../AuthShell";

export const metadata = signupMetadata;

/** See the note in ../login/page.tsx: the provider list is env-derived and must not be cached. */
export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await redirectIfSignedIn();

  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  return (
    <AuthShell
      eyebrow="Free, forever"
      title="Create your library."
      intro="An account adds one thing: somewhere for results to live. The upscaler and downloader work without one."
    >
      <OAuthErrorNotice code={first(params.oauth_error)} providerId={first(params.oauth_provider)} />
      <AuthForm mode="signup" />
      <ProviderButtons />
    </AuthShell>
  );
}
