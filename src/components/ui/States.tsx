import { RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./Button";
import { Icon } from "./Icon";

// Empty and error states (section 15). They are deliberately different:
// empty is calm and neutral with one primary action; error is tinted, says what went wrong, and offers Retry.

type EmptyStateProps = {
  icon: LucideIcon;
  /** One line, e.g. "No tasks yet. Create the first one." */
  title: string;
  /** One primary action (a Button or Link). */
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-4 px-4 py-12 text-center", className)}>
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-hover text-ink-2">
        <Icon icon={icon} />
      </span>
      <p className="max-w-sm text-body text-ink">{title}</p>
      {action}
    </div>
  );
}

type ErrorStateProps = {
  /** What went wrong, in plain words. Never a stack trace or internal code. */
  title: string;
  /** How to proceed. */
  description?: string;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
};

export function ErrorState({ title, description, onRetry, retrying, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-4 rounded-card border border-danger-line bg-danger-soft px-4 py-10 text-center",
        className,
      )}
    >
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-card text-danger-ink">
        <Icon icon={TriangleAlert} />
      </span>
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-body font-medium text-ink">{title}</p>
        {description && <p className="text-secondary text-ink">{description}</p>}
      </div>
      {onRetry && (
        <Button variant="secondary" icon={RefreshCw} loading={retrying} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
