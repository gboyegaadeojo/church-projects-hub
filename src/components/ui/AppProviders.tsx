import type { ReactNode } from "react";
import { Toaster } from "./Toast";
import { TooltipProvider } from "./Tooltip";

/** UI-level providers mounted once at the root: tooltips and the toast viewport. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={400}>
      {children}
      <Toaster />
    </TooltipProvider>
  );
}
