import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/billing/admin";
import { poolSnapshot } from "@/lib/billing/quota";
import { settingsWithSources, DEFAULT_SETTINGS } from "@/lib/billing/settings";
import { capability } from "@/lib/billing/costs";
import { formatBytes } from "@/lib/utils";
import { pageMetadata } from "@/lib/seo";
import { Card, Eyebrow } from "@/components/ui/Button";
import { SandboxNotice } from "@/components/billing/SandboxNotice";
import { Meter } from "@/components/billing/Meter";
import { AlertTriangle, KeyRound, Users } from "lucide-react";

export const metadata = pageMetadata({
  title: "Admin — Sandbox",
  description: "Provider pool, plan configuration, and performance activation state.",
  path: "/admin",
  noIndex: true,
});

export default async function AdminPage() {
  // An anonymous visitor is redirected like every other private page. A signed-in non-admin
  // is refused explicitly, because silently showing them an empty admin page would look like
  // a working screen with no data in it.
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (!isAdmin(user.id)) return <NotAnAdmin />;
  const admin = user;

  const pool = poolSnapshot();
  const { current: cfg, keys } = settingsWithSources();
  const caps = capability();

  return (
    <div className="mx-auto max-w-[980px] px-5 pt-12 pb-20 sm:px-8">
      <Eyebrow>Admin</Eyebrow>
      <h1 className="text-h1 mt-5 font-bold">Sandbox control</h1>
      <p className="text-slate mt-3 text-[14px]">
        Signed in as <span className="text-chalk">{admin.email}</span>. Nothing on this page
        activates a provider or takes a payment.
      </p>

      <SandboxNotice className="mt-9" />

      {/* pool */}
      <section className="mt-10">
        <h2 className="text-h2 font-bold">Shared provider pool</h2>
        <p className="text-mist mt-2.5 max-w-2xl text-[14px] leading-relaxed">
          One number covers every account. Handing each user the full provider quota is how a
          free tier oversells itself on its first busy day, so assigned quota is compared
          against the pool here rather than discovered later.
        </p>

        <Card className="mt-6 p-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Figure label="Pool" value={formatBytes(pool.poolBytes)} sub={pool.providerName ?? "no provider configured"} />
            <Figure label="Assigned across accounts" value={formatBytes(pool.assignedBytes)} sub={`${pool.userCount} accounts, ${pool.payingUsers} paying`} />
            <Figure label="Actually used" value={formatBytes(pool.usedBytes)} sub={`${formatBytes(pool.availableBytes)} free`} />
          </div>

          <Meter
            className="mt-7"
            label="Assigned versus pool"
            used={pool.assignedBytes}
            ceiling={pool.poolBytes}
            overBy={pool.overAssigned ? pool.assignedBytes - pool.poolBytes : 0}
          />

          {pool.overAssigned && (
            <div className="border-[#e05252]/40 bg-[#e05252]/[0.07] mt-6 flex items-start gap-3 rounded-[var(--radius-md)] border p-4">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#e05252]" aria-hidden="true" />
              <p className="text-mist text-[13px] leading-relaxed">
                <span className="text-chalk font-semibold">Over-assigned.</span> The accounts
                promise {formatBytes(pool.assignedBytes)} but the store holds{" "}
                {formatBytes(pool.poolBytes)}. That is a promise the service cannot keep. Raise
                the pool, lower the per-plan quota, or accept that late signups cannot upload
                until someone frees space.
              </p>
            </div>
          )}
        </Card>
      </section>

      {/* performance */}
      <section className="mt-12">
        <h2 className="text-h2 font-bold">Provider performance</h2>
        <Card className="mt-6 p-6">
          <div className="flex items-start gap-3">
            <KeyRound className="text-slate mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-chalk text-[14px] font-semibold">
                No performance has been requested.
              </p>
              <p className="text-mist mt-2 text-[13px] leading-relaxed">
                Activation is a four-step path and the first step has not run:{" "}
                <span className="text-chalk">sandbox</span> →{" "}
                <span className="text-slate">awaiting_webhook</span> →{" "}
                <span className="text-slate">verified</span> →{" "}
                <span className="text-slate">enabled</span>. A provider event is never
                activated on sight; it waits for a signed callback, and the same event cannot be
                replayed into a second grant because the record is keyed by provider reference.
              </p>
            </div>
          </div>
        </Card>
      </section>

      {/* settings */}
      <section className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-h2 font-bold">Configuration in effect</h2>
          <p className="text-slate text-[13px] tabular-nums">
            {keys.length} of {Object.keys(DEFAULT_SETTINGS).length} groups overridden
          </p>
        </div>

        <div className="border-obsidian-700 mt-6 overflow-hidden rounded-[var(--radius-lg)] border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-obsidian-700 bg-obsidian-900/80 text-mono-caps text-slate border-b">
                <th scope="col" className="px-5 py-3.5 font-normal">Setting</th>
                <th scope="col" className="px-5 py-3.5 text-right font-normal">In effect</th>
                <th scope="col" className="px-5 py-3.5 text-right font-normal">Default</th>
                <th scope="col" className="px-5 py-3.5 text-right font-normal">Source</th>
              </tr>
            </thead>
            <tbody>
              {flatten(cfg).map(([k, value, fallback]) => {
                const overridden = keys.includes(k);
                const changed = JSON.stringify(value) !== JSON.stringify(fallback);
                return (
                  <tr key={k} className="border-obsidian-800 border-b last:border-b-0">
                    <td className="text-chalk px-5 py-2.5 font-mono text-[12px]">{k}</td>
                    <td className="text-mist px-5 py-2.5 text-right tabular-nums">{show(value)}</td>
                    <td className="text-slate px-5 py-2.5 text-right tabular-nums">{show(fallback)}</td>
                    <td className="px-5 py-2.5 text-right">
                      {overridden ? (
                        <span className={changed ? "text-acid-500" : "text-slate"}>
                          {changed ? "row" : "same"}
                        </span>
                      ) : (
                        <span className="text-slate">default</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-slate mt-4 text-[12px] leading-relaxed">
          <span className="text-mist">row</span> means the stored value is overridden and
          differs from the default, which is the only combination worth investigating.{" "}
          <span className="text-mist">same</span> means a row exists but matches the default,
          so it can be cleared. Prices stay unpublished:{" "}
          <span className="text-chalk">{String(cfg.price.published)}</span>.
        </p>
      </section>

      <Card className="mt-12 p-6">
        <div className="flex items-start gap-3">
          <Users className="text-slate mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="text-mist text-[13px] leading-relaxed">
            {pool.userCount} account{pool.userCount === 1 ? "" : "s"} on this deployment.
            Concurrent processing is capped at {caps.limits.max_concurrent_global} globally and{" "}
            {caps.limits.max_concurrent_per_user} per account, because the scarce resource is a
            single device rather than a fleet. A hold abandoned by a dead process is reclaimed
            after {caps.limits.hold_ttl_seconds} seconds.
          </p>
        </div>
      </Card>
    </div>
  );
}

/** Shown to a signed-in account without the flag. Says what is missing, not what it found. */
function NotAnAdmin() {
  return (
    <div className="mx-auto max-w-[980px] px-5 pt-12 pb-20 sm:px-8">
      <Eyebrow>Admin</Eyebrow>
      <h1 className="text-h1 mt-5 font-bold">Not an administrator</h1>
      <Card className="mt-8 p-6">
        <p className="text-mist text-[14px] leading-relaxed">
          This account is signed in but is not flagged as an administrator, so the deployment
          configuration is not shown. The flag is set directly in the database, because the page
          that would set it is this one.
        </p>
        <p className="text-slate mt-4 text-[12px] leading-relaxed">
          On a local build:{" "}
          <span className="text-chalk font-mono">node tools/grant-admin.mjs you@example.com</span>
        </p>
      </Card>
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="text-mono-caps text-slate">{label}</p>
      <p className="font-display text-acid-500 mt-2 text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-slate mt-1 text-[12px]">{sub}</p>
    </div>
  );
}

function flatten(cfg: Record<string, unknown>): [string, unknown, unknown][] {
  const out: [string, unknown, unknown][] = [];
  const d = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  for (const [group, values] of Object.entries(cfg)) {
    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      out.push([`${group}.${key}`, value, (d[group] as Record<string, unknown>)[key]]);
    }
  }
  return out;
}

function show(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") {
    if (Math.abs(v) >= 1024 * 1024 * 1024) return `${(v / 1073741824).toFixed(1)} GB`;
    if (Math.abs(v) >= 1024 * 1024) return `${(v / 1048576).toFixed(0)} MB`;
    return String(v);
  }
  return String(v);
}
