import { CircleAlert, CircleCheck, Clock, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Icon } from "./Icon";

// Badges and chips (section 15). Status badges always carry an icon and a text label, never colour alone.
export type BadgeTone =
  | "neutral"
  | "accent"
  | "overdue"
  | "due-soon"
  | "done"
  | "success"
  | "warning"
  | "error"
  | "info";

const tones: Record<BadgeTone, { classes: string; icon?: LucideIcon }> = {
  neutral: { classes: "bg-hover text-ink border-line" },
  accent: { classes: "bg-accent-soft text-accent-ink border-info-line" },
  overdue: { classes: "bg-overdue-soft text-overdue-ink border-overdue-line", icon: CircleAlert },
  "due-soon": { classes: "bg-due-soon-soft text-due-soon-ink border-due-soon-line", icon: Clock },
  done: { classes: "bg-done-soft text-done-ink border-done-line", icon: CircleCheck },
  success: { classes: "bg-success-soft text-success-ink border-success-line", icon: CircleCheck },
  warning: { classes: "bg-warning-soft text-warning-ink border-warning-line", icon: TriangleAlert },
  error: { classes: "bg-danger-soft text-danger-ink border-danger-line", icon: CircleAlert },
  info: { classes: "bg-info-soft text-info-ink border-info-line", icon: Info },
};

const badgeBase = "inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 text-label whitespace-nowrap";

type BadgeProps = {
  tone?: BadgeTone;
  /** Override or remove (null) the tone's default icon. */
  icon?: LucideIcon | null;
  children: ReactNode;
  className?: string;
};

export function Badge({ tone = "neutral", icon, children, className }: BadgeProps) {
  const style = tones[tone];
  const glyph = icon === null ? undefined : (icon ?? style.icon);
  return (
    <span className={cn(badgeBase, style.classes, className)}>
      {glyph && <Icon icon={glyph} size="sm" />}
      {children}
    </span>
  );
}

type ChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  /** Toggle chip (e.g. a filter). */
  selected?: boolean;
  /** Shows a remove button instead of acting as a toggle. */
  onRemove?: () => void;
};

/** Interactive chip: a toggleable filter, or a removable value. Meets the 44 px touch target. */
export function Chip({ label, selected, onRemove, className, ...rest }: ChipProps) {
  const chipClasses = cn(
    "inline-flex min-h-touch items-center gap-1 rounded-chip border px-3 text-secondary",
    "transition-colors duration-(--duration-menu) ease-out",
    selected ? "border-accent bg-accent-soft text-accent-ink" : "border-line-strong bg-card text-ink",
  );

  if (onRemove) {
    return (
      <span className={cn(chipClasses, "pr-0", className)}>
        {label}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className="inline-flex size-touch items-center justify-center rounded-chip text-ink-2 state-hover:text-ink"
        >
          <Icon icon={X} size="sm" />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={selected ?? false}
      className={cn(
        chipClasses,
        "state-hover:bg-hover disabled:cursor-not-allowed disabled:border-line disabled:bg-disabled disabled:text-ink-disabled",
        selected && "state-hover:bg-accent-soft",
        className,
      )}
      {...rest}
    >
      {selected && <Icon icon={CircleCheck} size="sm" />}
      {label}
    </button>
  );
}
