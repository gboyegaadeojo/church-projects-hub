import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** A page inside the app shell: one h1, optional actions beside it, readable width. */
export function PageLayout({
  title,
  actions,
  intro,
  children,
  className,
  wide = false,
}: {
  title: string;
  actions?: ReactNode;
  /** A line under the title. */
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Full width, for the board (its columns scroll sideways). */
  wide?: boolean;
}) {
  return (
    <div className={cn("mx-auto flex w-full flex-col gap-group px-4 py-8 md:px-8", !wide && "max-w-page", className)}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-title text-ink">{title}</h1>
          {actions}
        </div>
        {intro && <div className="text-body text-ink-2">{intro}</div>}
      </div>
      {children}
    </div>
  );
}
