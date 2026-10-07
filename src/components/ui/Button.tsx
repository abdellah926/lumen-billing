import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonTier = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export function btn(tier: ButtonTier = "primary", size: ButtonSize = "md") {
  const base = "inline-flex items-center justify-center rounded-[var(--radius-md)] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-acid-500/80 disabled:cursor-not-allowed disabled:opacity-60";
  const sizeMap = {
    sm: "h-9 px-3.5 text-[13px]",
    md: "h-11 px-4 text-[14px]",
    lg: "h-12 px-5 text-[15px]",
  };
  const tierMap = {
    primary: "bg-acid-500 text-obsidian-950 hover:bg-acid-400",
    secondary: "bg-obsidian-800 text-chalk hover:bg-obsidian-700",
    ghost: "bg-transparent text-mist hover:bg-obsidian-800 hover:text-chalk",
  };
  return `${base} ${sizeMap[size]} ${tierMap[tier]}`;
}

export function Button({
  tier = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tier?: ButtonTier; size?: ButtonSize }) {
  return (
    <button type="button" className={`${btn(tier, size)} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function ButtonLink({
  tier = "primary",
  size = "md",
  className = "",
  children,
  href,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; tier?: ButtonTier; size?: ButtonSize }) {
  return (
    <Link href={href} className={`${btn(tier, size)} ${className}`.trim()} {...props}>
      {children}
    </Link>
  );
}

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`border-obsidian-700 bg-obsidian-900/70 rounded-[var(--radius-lg)] border ${className}`}>{children}</div>;
}

export function Eyebrow({ className = "", children }: { className?: string; children: ReactNode }) {
  return <p className={`text-mono-caps text-slate ${className}`}>{children}</p>;
}
