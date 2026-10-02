"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={`text-mist hover:text-chalk hover:bg-obsidian-800 grid size-10 shrink-0 place-items-center rounded-[var(--radius-sm)] transition-colors duration-150 ${className}`}
    >
      {/* Both icons are always mounted and cross-faded, so the button does not
          change width between states. */}
      <Sun
        className={`absolute size-[18px] transition-all duration-200 ${
          theme === "light" ? "scale-100 rotate-0 opacity-100" : "scale-50 -rotate-90 opacity-0"
        }`}
      />
      <Moon
        className={`size-[18px] transition-all duration-200 ${
          theme === "dark" ? "scale-100 rotate-0 opacity-100" : "scale-50 rotate-90 opacity-0"
        }`}
      />
    </button>
  );
}
