import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The banner that states plainly what state this build is in.
 *
 * It exists because the numbers on this page are enforced for real, but nothing has been
 * activated for payment. Someone reading a quota has to be able to tell the difference
 * between "this is your allowance" and "this is what your allowance would be", and the
 * second reading has to be the obvious one rather than something in a footer.
 */
export function SandboxNotice({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "border-obsidian-700 bg-obsidian-900/60 flex items-start gap-3 rounded-[var(--radius-md)] border px-4 py-3.5",
        className,
      )}
      role="note"
    >
      <FlaskConical className="text-slate mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="text-slate text-[13px] leading-relaxed">
        <span className="text-mist">Sandbox build.</span> Quotas and credits are measured and
        enforced server-side right now, but no payment provider is connected and no provider
        performance has been activated. No currency amount appears anywhere in this build until
        the real cost per operation is confirmed.
      </p>
    </div>
  );
}
