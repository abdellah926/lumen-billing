"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { nav } from "@/lib/site";
import { cn } from "@/lib/utils";
import { ButtonLink, btn } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ThemeToggle";

function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="Lumen home">
      <span className="relative grid size-8 place-items-center rounded-[var(--radius-sm)] bg-acid-500">
        <span className="size-2.5 rounded-[2px] bg-obsidian-950 transition-transform duration-300 group-hover:scale-125" />
      </span>
      <span className="font-display text-[17px] font-bold tracking-tight text-chalk">
        Lumen
      </span>
    </Link>
  );
}

export function Header({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  // Storing the route the drawer was opened on means a navigation closes it for free:
  // the comparison goes false on the next render, so there is no effect to run.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Prevent background scroll while the drawer is open.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-[background-color,border-color] duration-200",
        scrolled
          ? "border-obsidian-700/80 bg-obsidian-950/85 border-b backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-6 px-5 sm:px-8">
        <Logo />

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative rounded-[var(--radius-sm)] px-3 py-2 text-sm transition-colors duration-150",
                  active ? "text-chalk" : "text-mist hover:text-chalk",
                )}
              >
                {item.label}
                {active && (
                  <span
                    className="bg-acid-500 absolute inset-x-3 -bottom-px h-px"
                    aria-hidden="true"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle className="-mr-1" />

          {signedIn ? (
            <>
              <Link href="/library" className={cn(btn("ghost", "sm"), "hidden sm:inline-flex")}>
                Library
              </Link>
              <Link
                href="/library/billing"
                className={cn(btn("ghost", "sm"), "hidden lg:inline-flex")}
              >
                Usage
              </Link>
              <ButtonLink href="/upscaler" tier="primary" size="sm">
                Open app
              </ButtonLink>
            </>
          ) : (
            <>
              <Link href="/login" className={cn(btn("ghost", "sm"), "hidden sm:inline-flex")}>
                Sign in
              </Link>
              <ButtonLink href="/upscaler" tier="primary" size="sm">
                Start free
              </ButtonLink>
            </>
          )}

          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="text-mist hover:text-chalk grid size-10 place-items-center rounded-[var(--radius-sm)] md:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {/* Drawer */}
      <div
        id="mobile-nav"
        hidden={!open}
        className="border-obsidian-700 bg-obsidian-950/98 border-t md:hidden"
      >
        <nav aria-label="Mobile" className="flex flex-col gap-1 px-5 py-4">
          {[
            ...nav,
            ...(signedIn
              ? [
                  { href: "/library", label: "Library" },
                  { href: "/library/billing", label: "Usage & billing" },
                ]
              : [{ href: "/login", label: "Sign in" }]),
          ].map(
            (item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-mist hover:bg-obsidian-800 hover:text-chalk rounded-[var(--radius-md)] px-3 py-3 text-[15px]"
              >
                {item.label}
              </Link>
            ),
          )}
          <ButtonLink href="/upscaler" tier="primary" size="lg" className="mt-2 w-full">
            Start free
          </ButtonLink>
        </nav>
      </div>
    </header>
  );
}
