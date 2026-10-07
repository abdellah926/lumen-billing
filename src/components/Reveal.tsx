import type { ReactNode } from "react";

export function Reveal({ children, delay }: { children: ReactNode; delay?: number }) {
  void delay;
  return <>{children}</>;
}
