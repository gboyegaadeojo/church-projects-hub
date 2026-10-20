import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn";
import { Icon } from "../ui/Icon";

export type Crumb = { to: string; label: string };

/** "Administration › Users": where this page sits, each step a link back. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-secondary text-ink-2">
        {items.map((c) => (
          <li key={c.to} className="flex items-center gap-1">
            <Link to={c.to} className="rounded-chip underline-offset-4 state-hover:text-ink state-hover:underline">
              {c.label}
            </Link>
            <Icon icon={ChevronRight} size="sm" />
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A page inside the app shell: breadcrumb, one h1, optional actions beside it, readable width. */
export function PageLayout({
  title,
  actions,
  intro,
  children,
  className,
  wide = false,
  breadcrumbs,
  leading,
  hero = false,
}: {
  title: string;
  actions?: ReactNode;
  /** A line under the title. */
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Full width, for the board (its columns scroll sideways). */
  wide?: boolean;
  /** The pages above this one. */
  breadcrumbs?: Crumb[];
  /** Beside the title, e.g. a project's tile. */
  leading?: ReactNode;
  /** The header sits on the soft brand banner (My Work's welcome). */
  hero?: boolean;
}) {
  const header = (
    <div className="flex flex-col gap-2">
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {leading}
          <h1 className={cn("text-ink", hero ? "text-large-title" : "text-title")}>{title}</h1>
        </div>
        {actions}
      </div>
      {intro && <div className="text-body text-ink-2">{intro}</div>}
    </div>
  );
  return (
    <div
      className={cn(
        "mx-auto flex w-full animate-rise-in flex-col gap-group px-4 py-6 md:px-8 md:py-8",
        !wide && "max-w-page",
        className,
      )}
    >
      {hero ? (
        <div className="relative overflow-hidden rounded-card border border-line bg-linear-120 from-hero-from to-hero-to px-5 py-6 md:px-8 md:py-8">
          {/* Soft brand glow in the corner; decorative only */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-linear-135 from-brand-from to-brand-to opacity-15 blur-2xl"
          />
          <div className="relative">{header}</div>
        </div>
      ) : (
        header
      )}
      {children}
    </div>
  );
}
