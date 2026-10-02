"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "lumen-theme";
const EVENT = "lumen-theme-change";

// The inline script below already wrote data-theme onto <html> before first
// paint, so the DOM is the single source of truth. React subscribes to it
// rather than mirroring it into state, which is what removes the setState
// inside an effect that would otherwise re-render on mount.
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function getServerTheme(): Theme {
  // Must match the data-theme the server rendered, or hydration disagrees.
  return "dark";
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);

  // Another tab changing the theme should move this one too.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) syncFromStorage();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

function apply(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing can refuse writes. The theme still applies for this
    // page view; it just will not be remembered.
  }
  emit();
}

function syncFromStorage() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    if (document.documentElement.getAttribute("data-theme") !== stored) apply(stored);
  }
}

export const themeScript = `(function(){try{var k=${JSON.stringify(
  STORAGE_KEY,
)};var t=localStorage.getItem(k);if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";}document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, getServerTheme);

  const setTheme = useCallback((next: Theme) => {
    apply(next);
  }, []);

  const toggle = useCallback(() => {
    apply(readTheme() === "dark" ? "light" : "dark");
  }, []);

  return { theme, setTheme, toggle };
}
