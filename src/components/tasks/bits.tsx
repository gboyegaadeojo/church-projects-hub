import {
  ArrowDown,
  ArrowUp,
  Bug,
  ChevronsUp,
  CircleDot,
  Equal,
  Layers,
  Lightbulb,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import { type DueStatus, dueStatus, type Label, type Priority, PRIORITY_LABELS, TASK_TYPE_LABELS, type TaskType } from "../../../shared/tasks";
import { cn } from "../../lib/cn";
import { PROJECT_COLOUR_CLASSES } from "../../lib/projects";
import { Badge } from "../ui/Badge";
import { Icon } from "../ui/Icon";

// Small pieces shared by board cards, list rows and the task detail. Status is never colour alone
// (section 13): each carries an icon shape and a text label, visible or announced.

export const PRIORITY_STYLE: Record<Priority, { icon: LucideIcon; className: string }> = {
  urgent: { icon: ChevronsUp, className: "text-danger-ink" },
  high: { icon: ArrowUp, className: "text-warning-ink" },
  medium: { icon: Equal, className: "text-ink-2" },
  low: { icon: ArrowDown, className: "text-info-ink" },
};

/** Priority as an icon with a tooltip and an accessible name; `withLabel` also shows the word. */
export function PriorityIndicator({ priority, withLabel = false }: { priority: Priority; withLabel?: boolean }) {
  const style = PRIORITY_STYLE[priority];
  const label = `Priority: ${PRIORITY_LABELS[priority]}`;
  if (withLabel) {
    return (
      <span className="inline-flex items-center gap-1">
        <Icon icon={style.icon} size="sm" className={style.className} />
        <span>{PRIORITY_LABELS[priority]}</span>
      </span>
    );
  }
  // No tooltip component: a 500-card board would mount 500 of them. The icon has an accessible name.
  return <Icon icon={style.icon} size="sm" className={style.className} label={label} />;
}

export const TYPE_ICONS: Record<TaskType, LucideIcon> = { task: CircleDot, bug: Bug, idea: Lightbulb, epic: Layers };

export function TypeIcon({ type }: { type: TaskType }) {
  return <Icon icon={TYPE_ICONS[type]} size="sm" className="text-ink-2" label={TASK_TYPE_LABELS[type]} />;
}

const DUE_TONE: Record<DueStatus, "overdue" | "due-soon" | "neutral"> = { overdue: "overdue", soon: "due-soon", later: "neutral" };
const DUE_WORD: Record<DueStatus, string> = { overdue: "Overdue", soon: "Due soon", later: "Due" };

/** "Mar 20" style date for a calendar date (no timezone shift: it is a date, not a moment). */
export function formatDate(date: string, withYear = false): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(
    Date.UTC(y!, m! - 1, d!),
  );
}

/**
 * Due date (section 11.3): red when overdue, amber when due within 7 days, in the viewer's timezone.
 * The badge's icon and words carry the meaning, not only the colour.
 */
export function DueBadge({ dueDate, today, done = false }: { dueDate: string | null; today: string; done?: boolean }) {
  const status = dueStatus(dueDate, today);
  if (!dueDate || !status) return null;
  const tone = done ? "neutral" : DUE_TONE[status];
  const word = done ? "Due" : DUE_WORD[status];
  return (
    <Badge tone={tone} icon={tone === "neutral" ? null : undefined} className="tabular-nums">
      <span className="sr-only">{word} </span>
      {formatDate(dueDate, dueDate.slice(0, 4) !== today.slice(0, 4))}
    </Badge>
  );
}

export function LabelChip({ label, className }: { label: Pick<Label, "name" | "colour">; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-chip border border-line px-1.5 py-0.5 text-label text-ink", className)}>
      <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", PROJECT_COLOUR_CLASSES[label.colour].bg)} />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

export function SubtaskProgress({ done, total }: { done: number; total: number }) {
  if (total === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-label text-ink-2 tabular-nums">
      <Icon icon={ListChecks} size="sm" />
      <span className="sr-only">Checklist: </span>
      {done}/{total}
    </span>
  );
}
