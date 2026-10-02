import Link from "next/link";
import { Check, Coins, Cpu, HardDrive, Minus, Timer } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { settings } from "@/lib/billing/settings";
import { capability } from "@/lib/billing/costs";
import { formatBytes } from "@/lib/utils";
import { ButtonLink, Card, Eyebrow } from "@/components/ui/Button";
import { Reveal } from "@/components/Reveal";
import { SandboxNotice } from "@/components/billing/SandboxNotice";

export const metadata = pageMetadata({
  title: "Pricing — Two Plans, Measured Costs",
  description:
    "A free tier funded by metered processing credits, and a paid tier with more of both. Credit rates come from measured GPU and network time.",
  path: "/pricing",
  keywords: ["lumen pricing", "free image upscaler", "ai upscaler credits", "free ai upscaler pricing"],
});

const INCLUDED = [
  "Every tool: upscale, convert, download",
  "Automatic filing into your library",
  "View, download, and delete at full resolution",
  "Nothing is ever deleted to make room",
];

export default function PricingPage() {
  const cfg = settings();
  const caps = capability();
  const published = cfg.price.published;

  return (
    <div className="mx-auto max-w-[980px] px-5 pt-12 pb-20 sm:px-8">
      <div className="max-w-2xl">
        <Eyebrow>Pricing</Eyebrow>
        <h1 className="text-h1 mt-5 font-bold">
          Two plans, and a number you can audit.
        </h1>
        <p className="text-mist mt-5 text-[17px] leading-relaxed">
          The cost of running an upscale is the GPU time it takes, and the cost of a download
          is the time it holds a connection open. Both are measured, so both become credits:
          spendable, expiring, and never &ldquo;unlimited&rdquo; with an asterisk.
        </p>
      </div>

      <SandboxNotice className="mt-9" />

      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {/* Free */}
        <Reveal>
          <Card className="h-full p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-bold">Free</h2>
                <p className="text-slate mt-1.5 text-[13px]">
                  {cfg.plan.free_credits} credits every{" "}
                  {cfg.plan.free_credits_period_days} days
                </p>
              </div>
              <span className="font-display text-chalk text-4xl font-bold">$0</span>
            </div>

            <div className="border-obsidian-800 mt-6 grid gap-3 border-t pt-6 text-[14px]">
              <Row label="Storage" value={formatBytes(cfg.plan.free_storage_bytes)} />
              <Row label="Largest single upload" value={formatBytes(caps.limits.upload_max_bytes)} />
              <Row label="Upscale source ceiling" value={`${caps.limits.upscale_max_megapixels} MP`} />
              <Row label="Video duration ceiling" value={`${Math.round(caps.limits.download_max_duration_seconds / 60)} min`} />
              <Row label="Concurrent jobs" value={String(caps.limits.max_concurrent_global)} />
            </div>

            <ul className="mt-6 grid gap-2.5">
              {INCLUDED.map((line) => (
                <li key={line} className="text-mist flex gap-2.5 text-[13px] leading-relaxed">
                  <Check className="text-acid-500 mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>

            <ButtonLink href="/signup" tier="secondary" size="lg" className="mt-8 w-full">
              Create a free library
            </ButtonLink>
          </Card>
        </Reveal>

        {/* Pro */}
        <Reveal delay={0.06}>
          <Card className="border-acid-500/35 glow-acid h-full p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-bold">Pro</h2>
                <p className="text-slate mt-1.5 text-[13px]">
                  {cfg.plan.pro_credits} credits every {cfg.plan.pro_credits_period_days} days
                </p>
              </div>
              <span className="text-right">
                {published ? (
                  <span className="font-display text-acid-500 text-4xl font-bold">
                    {cfg.price.currency}
                    {cfg.price.pro_month}
                  </span>
                ) : (
                  <span className="font-display text-slate text-3xl font-bold">—</span>
                )}
              </span>
            </div>

            {!published && (
              <p className="text-slate mt-3 text-[12px] leading-relaxed">
                Price not published yet. It is one measured hosting-cost number away.
              </p>
            )}

            <div className="border-obsidian-800 mt-6 grid gap-3 border-t pt-6 text-[14px]">
              <Row label="Storage" value={formatBytes(cfg.plan.pro_storage_bytes)} />
              <Row label="Credits per period" value={String(cfg.plan.pro_credits)} />
              <Row label="Extra storage available" value="Yes, and it survives cancelling" />
              <Row label="Cancel" value="Keeps every file, forever" />
            </div>

            <ul className="mt-6 grid gap-2.5">
              {[
                "Everything in Free",
                `${cfg.plan.pro_storage_bytes / (1024 * 1024 * 1024)} GB of library`,
                "Purchased storage is never revoked on cancel",
                "Priority when the single processing slot is busy",
              ].map((line) => (
                <li key={line} className="text-mist flex gap-2.5 text-[13px] leading-relaxed">
                  <Check className="text-acid-500 mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>

            <ButtonLink href="/signup" tier="primary" size="lg" className="mt-8 w-full">
              Start free, upgrade later
            </ButtonLink>
          </Card>
        </Reveal>
      </div>

      {/* why credits */}
      <section className="mt-20">
        <h2 className="text-h2 font-bold">Why credits instead of a rate limit</h2>
        <p className="text-mist mt-3 max-w-2xl text-[15px] leading-relaxed">
          A rate limit tells a heavy user to wait and gives a light user nothing to think about.
          A credit balance is the same idea with the receipt attached: you can see what an
          operation costs before you run it, and unused credits expire rather than rolling over
          into an unbounded liability.
        </p>

        <div className="mt-7 grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Cpu,
              title: "Measured, not guessed",
              body: "The upscale rate comes from a real run: a 2.07 MP source at 4× took 20 seconds and 1,254 MB on a mid-range GPU. That becomes roughly ten seconds of GPU per credit.",
            },
            {
              icon: Timer,
              title: "Wall-clock is the real cost",
              body: "A download holds one connection for the whole file. At the measured 2.56 MB/s, a minute of video is about a minute of your credit, whatever the resolution.",
            },
            {
              icon: HardDrive,
              title: "Storage is separate",
              body: "Space is what you keep, credits are what you process. Cancelling lowers the space you can add to; it never deletes what you already stored.",
            },
          ].map((c, i) => (
            <Reveal key={c.title} delay={i * 0.06}>
              <Card className="h-full p-6">
                <c.icon className="text-acid-500 size-5" aria-hidden="true" />
                <h3 className="mt-4 font-semibold">{c.title}</h3>
                <p className="text-mist mt-2.5 text-[14px] leading-relaxed">{c.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      {/* comparison */}
      <section className="mt-20">
        <h2 className="text-h2 font-bold">What each plan changes</h2>
        <div className="border-obsidian-700 mt-6 overflow-hidden rounded-[var(--radius-lg)] border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-obsidian-700 bg-obsidian-900/80 text-mono-caps text-slate border-b">
                <th scope="col" className="px-5 py-3.5 font-normal">
                  Capability
                </th>
                <th scope="col" className="px-5 py-3.5 text-center font-normal">
                  No account
                </th>
                <th scope="col" className="px-5 py-3.5 text-center font-normal">
                  Free
                </th>
                <th scope="col" className="px-5 py-3.5 text-center font-normal">
                  Pro
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Every tool and format", true, true, true],
                ["Results kept between sessions", false, true, true],
                ["Storage ceiling", false, formatBytes(cfg.plan.free_storage_bytes), formatBytes(cfg.plan.pro_storage_bytes)],
                ["Processing credits per period", false, String(cfg.plan.free_credits), String(cfg.plan.pro_credits)],
                ["Buy extra storage", false, false, true],
                ["Automatic filing by media type", false, true, true],
              ].map(([cap, anon, free, pro]) => (
                <tr key={String(cap)} className="border-obsidian-800 border-b last:border-b-0">
                  <td className="text-chalk px-5 py-3.5">{String(cap)}</td>
                  {[anon, free, pro].map((v, i) => (
                    <td key={i} className="text-center">
                      {typeof v === "boolean" ? (
                        v ? (
                          <Check className="text-acid-500 mx-auto size-4" aria-hidden="true" />
                        ) : (
                          <Minus className="text-slate mx-auto size-4" aria-hidden="true" />
                        )
                      ) : (
                        <span className="text-mist tabular-nums">{String(v)}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Card className="mt-14 p-6">
        <div className="flex items-start gap-3">
          <Coins className="text-slate mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="text-mist text-[14px] leading-relaxed">
            <span className="text-chalk">The Pro price is the one thing missing.</span> Every
            rate on this page is enforced by the server and readable in{" "}
            <Link href="/library/billing" className="underline">
              your usage
            </Link>
            . Pricing is withheld until the cost per operation is confirmed on a real
            deployment, because a price nobody measured is just a guess with a payment form
            attached to it.
          </p>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-slate">{label}</span>
      <span className="text-chalk text-right tabular-nums">{value}</span>
    </div>
  );
}
