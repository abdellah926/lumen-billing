import { cn } from "@/lib/utils";

/**
 * A quota bar that can be honest about being over.
 *
 * The failure mode this avoids: a bar that silently saturates and looks like "full" whether
 * the account is at 99% or 400% of its allowance. After a downgrade the account can genuinely
 * exceed the ceiling, so the bar says so in words rather than only in colour.
 */
export function Meter({
  label,
  used,
  ceiling,
  held = 0,
  overBy = 0,
  className,
}: {
  label: string;
  used: number;
  ceiling: number;
  held?: number;
  overBy?: number;
  className?: string;
}) {
  const over = overBy > 0;
  const pct = ceiling > 0 ? Math.min(100, (used / ceiling) * 100) : 0;
  const heldPct = ceiling > 0 ? Math.min(100 - pct, (held / ceiling) * 100) : 0;
  const warn = !over && pct >= 80;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-mono-caps text-slate">{label}</span>
        <span
          className={cn(
            "text-[13px] tabular-nums",
            over ? "text-[#e05252]" : warn ? "text-acid-500" : "text-chalk",
          )}
        >
          {over ? `${Math.round((used / Math.max(1, ceiling)) * 100)}% of allowance` : `${Math.round(pct)}%`}
        </span>
      </div>

      <div
        className="bg-obsidian-800 mt-2 h-2 overflow-hidden rounded-full"
        role="progressbar"
        aria-label={`${label} used`}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-describedby={over ? `${label}-over` : undefined}
      >
        <div className="flex h-full">
          <div
            className={cn(
              "h-full transition-[width] duration-500 ease-out",
              over ? "bg-[#e05252]" : warn ? "bg-acid-400" : "bg-acid-500",
            )}
            style={{ width: `${pct}%` }}
          />
          {/* Reserved space is drawn hatched rather than in the accent colour, so an
              in-flight upload is visibly different from bytes that have landed. */}
          {heldPct > 0 && (
            <div
              className="bg-acid-500/40 h-full border-l border-acid-500/70"
              style={{ width: `${heldPct}%` }}
              title={`${held} bytes reserved by uploads in flight`}
            />
          )}
        </div>
      </div>

      {over && (
        <p id={`${label}-over`} className="text-slate mt-2 text-[12px]">
          Over the ceiling by{" "}
          <span className="text-[#e05252] tabular-nums">{overBy.toLocaleString()} bytes</span>.
          Uploads are paused; nothing is deleted for you.
        </p>
      )}
    </div>
  );
}
