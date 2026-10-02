import Link from "next/link";
import { AlertTriangle, Coins, HardDrive } from "lucide-react";
import { formatBytes } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * Allowance at a glance, on the page the user already visits.
 *
 * A quota that lives only on a billing page is a quota nobody checks before uploading, and the
 * failure is discovering it as a rejected file. The strip is deliberately one line of text plus
 * one bar: it reports the remaining space and the credit balance, and it goes red only when
 * uploads have actually stopped, because an alarming banner that is wrong every day gets
 * ignored.
 */
export function UsageStrip({
  usedBytes,
  remainingBytes,
  quotaBytes,
  overByBytes,
  credits,
  canUpload,
}: {
  usedBytes: number;
  remainingBytes: number;
  quotaBytes: number;
  overByBytes: number;
  credits: number;
  canUpload: boolean;
}) {
  const over = overByBytes > 0;
  const pct = quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0;
  const low = !over && remainingBytes <= quotaBytes * 0.1;

  return (
    <div
      className={cn(
        "mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[var(--radius-md)] border px-4 py-3",
        over || low ? "border-[#e05252]/40 bg-[#e05252]/[0.06]" : "border-obsidian-700 bg-obsidian-900/50",
      )}
    >
      <div className="min-w-[190px] flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-mist flex items-center gap-1.5 text-[13px]">
            <HardDrive className="size-3.5 shrink-0" aria-hidden="true" />
            {over ? (
              <span className="text-chalk">
                Over the allowance by{" "}
                <span className="tabular-nums">{formatBytes(overByBytes)}</span>
              </span>
            ) : (
              <span className="tabular-nums">
                {formatBytes(remainingBytes)} left of {formatBytes(quotaBytes)}
              </span>
            )}
          </span>
          <span className="text-slate flex items-center gap-1.5 text-[13px] tabular-nums">
            <Coins className="size-3.5 shrink-0" aria-hidden="true" />
            {credits} credits
          </span>
        </div>

        <div className="bg-obsidian-800 mt-2 h-1.5 overflow-hidden rounded-full">
          <div
            className={cn(
              "h-full transition-[width] duration-500 ease-out",
              over ? "bg-[#e05252]" : low ? "bg-[#e05252]/70" : "bg-acid-500",
            )}
            style={{ width: `${over ? 100 : pct}%` }}
          />
        </div>
      </div>

      {over ? (
        <p className="text-mist flex items-center gap-1.5 text-[12px]">
          <AlertTriangle className="size-3.5 shrink-0 text-[#e05252]" aria-hidden="true" />
          Uploads paused. Everything here stays.
        </p>
      ) : (
        <p className="text-slate text-[12px]">
          {canUpload ? "Uploads open." : "Uploads paused."}
        </p>
      )}

      <Link href="/library/billing" className="text-mist hover:text-chalk text-[13px] underline">
        Details
      </Link>
    </div>
  );
}
