import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Clock, Coins, HardDrive, Timer, TrendingUp } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { storageSnapshot } from "@/lib/billing/quota";
import { creditSnapshot } from "@/lib/billing/credits";
import { settings } from "@/lib/billing/settings";
import { capability } from "@/lib/billing/costs";
import { pageMetadata } from "@/lib/seo";
import { formatBytes } from "@/lib/utils";
import { ButtonLink, Card, Eyebrow } from "@/components/ui/Button";
import { Meter } from "@/components/billing/Meter";
import { SandboxNotice } from "@/components/billing/SandboxNotice";

export const metadata = pageMetadata({
  title: "Usage & Billing",
  description: "Your storage, your processing credits, and the exact limits this deployment runs under.",
  path: "/library/billing",
  noIndex: true,
});

export default async function BillingPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/library/billing");

  const storage = storageSnapshot(user.id);
  const credits = creditSnapshot(user.id);
  const cfg = settings();
  const caps = capability();

  // One credit is priced as roughly ten seconds of the scarce resource, which is what makes
  // the grant meaningful rather than an arbitrary number. Both rates are measured, not chosen.
  const secondsPerCredit = 10;

  return (
    <div className="mx-auto max-w-[980px] px-5 pt-12 pb-20 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-2xl">
          <Eyebrow>Usage &amp; billing</Eyebrow>
          <h1 className="text-h1 mt-5 font-bold">Where your allowance went</h1>
          <p className="text-mist mt-4 text-[15px] leading-relaxed">
            Signed in as <span className="text-chalk">{user.email}</span>. Everything below is
            counted server-side, so it cannot drift from what the tools actually did.
          </p>
        </div>
        <ButtonLink href="/library" tier="secondary" size="sm">
          Back to library
        </ButtonLink>
      </div>

      <SandboxNotice className="mt-9" />

      {/* plan + storage */}
      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-mono-caps text-slate">Plan</p>
              <p className="font-display mt-2 text-3xl font-bold capitalize">{storage.plan}</p>
            </div>
            <HardDrive className="text-acid-500 size-5" aria-hidden="true" />
          </div>

          {storage.graceUntil && (
            <p className="text-mist mt-4 flex items-start gap-2 text-[13px] leading-relaxed">
              <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Cancelled. You keep the paid plan until{" "}
                <span className="text-chalk">
                  {new Date(storage.graceUntil).toLocaleDateString()}
                </span>
                , then drop to the free allowance. Your files stay either way.
              </span>
            </p>
          )}

          <div className="mt-6">
            <Meter
              label="Storage"
              used={storage.usedBytes}
              ceiling={storage.quotaBytes}
              overBy={storage.overByBytes}
              held={storage.heldBytes}
            />
            <dl className="text-slate mt-3 grid gap-1 text-[12px]">
              <div className="flex justify-between">
                <dt>Plan allowance</dt>
                <dd className="tabular-nums">{formatBytes(storage.planBytes)}</dd>
              </div>
              {storage.extraBytes > 0 && (
                <div className="flex justify-between">
                  <dt>Purchased (survives cancellation)</dt>
                  <dd className="tabular-nums">+{formatBytes(storage.extraBytes)}</dd>
                </div>
              )}
              {storage.heldBytes > 0 && (
                <div className="flex justify-between">
                  <dt>Reserved by uploads in flight</dt>
                  <dd className="tabular-nums">{formatBytes(storage.heldBytes)}</dd>
                </div>
              )}
              <div className="text-chalk flex justify-between border-t border-obsidian-800 pt-1">
                <dt>Remaining</dt>
                <dd className="tabular-nums">
                  {storage.remainingBytes > 0
                    ? formatBytes(storage.remainingBytes)
                    : "full — delete something first"}
                </dd>
              </div>
            </dl>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-mono-caps text-slate">Processing credits</p>
              <p className="font-display text-acid-500 mt-2 text-3xl font-bold tabular-nums">
                {credits.balance}
              </p>
            </div>
            <Coins className="text-acid-500 size-5" aria-hidden="true" />
          </div>

          <p className="text-slate mt-2 text-[13px] leading-relaxed">
            {credits.held > 0 ? `${credits.held} reserved by work in progress. ` : ""}
            One credit is about {secondsPerCredit} seconds of the GPU or the network, whichever
            you use.
          </p>

          <div className="mt-6">
            {credits.buckets.length === 0 ? (
              <p className="text-slate text-[13px]">
                No credits yet. A free account is granted{" "}
                <span className="text-chalk">{cfg.plan.free_credits}</span> every{" "}
                {cfg.plan.free_credits_period_days} days once you run a tool.
              </p>
            ) : (
              <ul className="grid gap-2">
                {credits.buckets.map((b) => (
                  <li
                    key={b.id}
                    className="border-obsidian-800 flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border px-3 py-2 text-[13px]"
                  >
                    <span className="text-mist flex items-center gap-2 capitalize">
                      {b.source.replace("_", " ")}
                      {!b.active && (
                        <span className="text-slate text-[11px]">
                          {b.remaining > 0 ? "expired" : "used"}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">
                      <span className={b.active ? "text-chalk" : "text-slate"}>
                        {b.remaining}
                      </span>
                      <span className="text-slate"> / {b.granted}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {credits.nextExpiry && (
              <p className="text-slate mt-3 flex items-center gap-1.5 text-[12px]">
                <Timer className="size-3" aria-hidden="true" />
                Earliest expiry {new Date(credits.nextExpiry).toLocaleDateString()}
              </p>
            )}
          </div>
        </Card>
      </section>

      {/* over quota */}
      {!storage.canUpload && (
        <Card className="border-[#e05252]/40 bg-[#e05252]/[0.07] mt-4 flex items-start gap-3 p-5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#e05252]" aria-hidden="true" />
          <div className="text-[13px] leading-relaxed">
            <p className="text-chalk font-semibold">
              You are {formatBytes(storage.overByBytes)} over the allowance.
            </p>
            <p className="text-mist mt-1.5">
              This happens after a downgrade, and it is not resolved by deleting anything
              automatically. Everything you have stays: you can view, download, and delete at
              full size. Only new uploads are paused until you are back under the ceiling.
            </p>
          </div>
        </Card>
      )}

      {/* what this deployment allows */}
      <section className="mt-14">
        <h2 className="text-h2 font-bold">This deployment&rsquo;s limits</h2>
        <p className="text-mist mt-2.5 text-[14px] leading-relaxed">
          Read from the same settings the server enforces, not from marketing copy.
        </p>

        <div className="border-obsidian-700 mt-6 overflow-hidden rounded-[var(--radius-lg)] border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-obsidian-700 bg-obsidian-900/80 text-mono-caps text-slate border-b">
                <th scope="col" className="px-5 py-3.5 font-normal">
                  Capability
                </th>
                <th scope="col" className="px-5 py-3.5 text-right font-normal">
                  Free
                </th>
                <th scope="col" className="px-5 py-3.5 text-right font-normal">
                  Pro
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Storage", formatBytes(cfg.plan.free_storage_bytes), formatBytes(cfg.plan.pro_storage_bytes)],
                ["Credits per period", String(cfg.plan.free_credits), String(cfg.plan.pro_credits)],
                ["Refresh period", `${cfg.plan.free_credits_period_days} days`, `${cfg.plan.pro_credits_period_days} days`],
                ["Largest single upload", formatBytes(caps.limits.upload_max_bytes), formatBytes(caps.limits.upload_max_bytes)],
                ["Upscale source ceiling", `${caps.limits.upscale_max_megapixels} MP`, `${caps.limits.upscale_max_megapixels} MP`],
                ["Maximum scale", `${caps.limits.upscale_max_scale}×`, `${caps.limits.upscale_max_scale}×`],
                ["Download ceiling", formatBytes(caps.limits.download_max_bytes), formatBytes(caps.limits.download_max_bytes)],
                ["Video duration ceiling", `${Math.round(caps.limits.download_max_duration_seconds / 60)} min`, `${Math.round(caps.limits.download_max_duration_seconds / 60)} min`],
                ["Concurrent jobs", String(caps.limits.max_concurrent_global), String(caps.limits.max_concurrent_global)],
              ].map(([cap, free, pro]) => (
                <tr key={cap} className="border-obsidian-800 border-b last:border-b-0">
                  <td className="text-chalk px-5 py-3.5">{cap}</td>
                  <td className="text-mist px-5 py-3.5 text-right tabular-nums">{free}</td>
                  <td className="text-mist px-5 py-3.5 text-right tabular-nums">{pro}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-slate mt-4 text-[12px] leading-relaxed">
          The megapixel ceiling is not a policy choice. It comes from what the upscaling engine
          actually needs in memory: a source above roughly{" "}
          {caps.limits.upscale_max_megapixels} megapixels asks for more RAM than a shared machine
          can promise, so it is refused before any credit is taken.
        </p>
      </section>

      {/* what a credit buys */}
      <section className="mt-14">
        <h2 className="text-h2 font-bold">What a credit buys</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {[
            {
              icon: TrendingUp,
              title: "An upscale",
              body: `About ${secondsPerCredit} seconds of GPU per credit, scaled by source megapixels and by the scale factor. A 2 MP source at 4× takes roughly ${Math.round(2 * 9.7)} seconds of wall time.`,
            },
            {
              icon: Timer,
              title: "A download",
              body: "About a minute of video per credit, because the cost is wall-clock: a held connection downloading at the measured 2.56 MB/s.",
            },
          ].map((c) => (
            <Card key={c.title} className="p-6">
              <c.icon className="text-acid-500 size-5" aria-hidden="true" />
              <h3 className="mt-4 font-semibold">{c.title}</h3>
              <p className="text-mist mt-2.5 text-[14px] leading-relaxed">{c.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <Card className="mt-12 p-6">
        <p className="text-mist text-[14px] leading-relaxed">
          <span className="text-chalk">No price is shown yet.</span> Every rate above is a
          measured cost, but the hosting cost per operation has not been confirmed on a real
          deployment, so this build renders limits and credit rates only. Publishing a currency
          amount before that would be a guess with a receipt.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <ButtonLink href="/upscaler" tier="primary" size="md">
            Use the upscaler
          </ButtonLink>
          <Link href="/pricing" className="btn-ghost-link text-mist hover:text-chalk text-sm underline">
            How this will be priced
          </Link>
        </div>
      </Card>
    </div>
  );
}
