import type { Priority, WorkflowState } from "../../../shared/tasks";
import { PRIORITY_LABELS } from "../../../shared/tasks";
import { cn } from "../../lib/cn";
import { Icon } from "../ui/Icon";
import { PRIORITY_STYLE } from "./bits";

// Colour that carries meaning across the board, list and task detail (section 9, v4.6), in the spirit of
// monday.com: every column has its own vivid colour, and status and priority show as solid pills. The pill's
// words always carry the meaning (section 13); the colour only helps the eye find it.

export type Vivid = "grey" | "blue" | "indigo" | "teal" | "green" | "orange" | "red" | "purple" | "pink";

/** Full class names so Tailwind finds them. Text on every vivid colour is white at ≥ 4.5:1 (contrast.test.ts). */
export const VIVID_CLASSES: Record<Vivid, { bg: string; text: string; border: string; edge: string }> = {
  grey: { bg: "bg-vivid-grey", text: "text-vivid-grey", border: "border-vivid-grey", edge: "border-l-vivid-grey" },
  blue: { bg: "bg-vivid-blue", text: "text-vivid-blue", border: "border-vivid-blue", edge: "border-l-vivid-blue" },
  indigo: { bg: "bg-vivid-indigo", text: "text-vivid-indigo", border: "border-vivid-indigo", edge: "border-l-vivid-indigo" },
  teal: { bg: "bg-vivid-teal", text: "text-vivid-teal", border: "border-vivid-teal", edge: "border-l-vivid-teal" },
  green: { bg: "bg-vivid-green", text: "text-vivid-green", border: "border-vivid-green", edge: "border-l-vivid-green" },
  orange: { bg: "bg-vivid-orange", text: "text-vivid-orange", border: "border-vivid-orange", edge: "border-l-vivid-orange" },
  red: { bg: "bg-vivid-red", text: "text-vivid-red", border: "border-vivid-red", edge: "border-l-vivid-red" },
  purple: { bg: "bg-vivid-purple", text: "text-vivid-purple", border: "border-vivid-purple", edge: "border-l-vivid-purple" },
  pink: { bg: "bg-vivid-pink", text: "text-vivid-pink", border: "border-vivid-pink", edge: "border-l-vivid-pink" },
};

const TODO_TONES: Vivid[] = ["grey", "blue", "teal", "indigo"];
const PROGRESS_TONES: Vivid[] = ["orange", "purple", "pink", "indigo"];
const DONE_TONES: Vivid[] = ["green", "teal"];

/**
 * A colour per workflow column, from its category and order: the first "to do" column (usually Backlog) is grey,
 * later ones blue; "in progress" columns are orange then purple; "done" is green. Stable as long as the columns are.
 */
export function columnTones(states: Pick<WorkflowState, "id" | "category" | "position">[]): Map<number, Vivid> {
  const seen = { todo: 0, in_progress: 0, done: 0 };
  const tones = new Map<number, Vivid>();
  for (const s of [...states].sort((a, b) => a.position - b.position)) {
    const list = s.category === "todo" ? TODO_TONES : s.category === "in_progress" ? PROGRESS_TONES : DONE_TONES;
    tones.set(s.id, list[seen[s.category]++ % list.length]!);
  }
  return tones;
}

export const PRIORITY_TONE: Record<Priority, Vivid> = { urgent: "red", high: "orange", medium: "indigo", low: "teal" };

const pill = "inline-flex items-center justify-center gap-1 rounded-chip px-2 py-0.5 text-label font-semibold whitespace-nowrap text-on-vivid";

/** A column's name on its colour, e.g. a green "Done". */
export function StatusPill({ name, tone, className }: { name: string; tone: Vivid; className?: string }) {
  return <span className={cn(pill, VIVID_CLASSES[tone].bg, className)}>{name}</span>;
}

/** Priority as a solid pill with its icon and word. */
export function PriorityPill({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <span className={cn(pill, VIVID_CLASSES[PRIORITY_TONE[priority]].bg, className)}>
      <Icon icon={PRIORITY_STYLE[priority].icon} size="sm" />
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
