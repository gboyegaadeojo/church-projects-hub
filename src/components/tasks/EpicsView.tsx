import { ChevronDown, CircleAlert, Layers, Plus } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { dueStatus, type Person, type TaskCard, type WorkflowState } from "../../../shared/tasks";
import { cn } from "../../lib/cn";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { EmptyState } from "../ui/States";
import { DueBadge, formatDate, TypeIcon } from "./bits";
import { columnTones, PriorityPill, StatusPill } from "./tones";

// Epics dashboard (ORG-3, v4.6): every epic with its progress — a bar split into done, in progress and to do — what's
// at risk (overdue, unassigned), when its work is due, who is on it, and its tasks one click away. The numbers come
// from the board data already loaded; filters narrow the tasks counted, and the search also matches epic titles.

type Category = WorkflowState["category"];

export type EpicsProps = {
  states: WorkflowState[];
  /** Every task in the project (to find the epics). */
  allTasks: TaskCard[];
  /** The tasks the current filters show (counted under each epic). */
  tasks: TaskCard[];
  people: Map<number, Person>;
  today: string;
  search: string;
  canEdit: boolean;
  onOpen: (task: TaskCard) => void;
  onNewEpic: () => void;
};

type EpicStats = {
  epic: TaskCard;
  children: TaskCard[];
  done: number;
  started: number;
  todo: number;
  overdue: number;
  unassigned: number;
  firstDue: string | null;
  lastDue: string | null;
  people: number[];
};

export function EpicsView({ states, allTasks, tasks, people, today, search, canEdit, onOpen, onNewEpic }: EpicsProps) {
  const categoryOf = useMemo(() => new Map(states.map((s) => [s.id, s.category])), [states]);
  const stats = useMemo(() => {
    const q = search.toLowerCase();
    const epics = allTasks.filter((t) => t.type === "epic" && (!q || `${t.key} ${t.title}`.toLowerCase().includes(q)));
    return epics.map((epic): EpicStats => {
      const children = tasks.filter((t) => t.epicId === epic.id);
      const cat = (t: TaskCard): Category => categoryOf.get(t.stateId) ?? "todo";
      const open = children.filter((t) => cat(t) !== "done");
      const dates = children.map((t) => t.dueDate).filter((d): d is string => !!d).sort();
      return {
        epic,
        children,
        done: children.filter((t) => cat(t) === "done").length,
        started: children.filter((t) => cat(t) === "in_progress").length,
        todo: children.filter((t) => cat(t) === "todo").length,
        overdue: open.filter((t) => dueStatus(t.dueDate, today) === "overdue").length,
        unassigned: open.filter((t) => t.assigneeId === null).length,
        firstDue: dates[0] ?? null,
        lastDue: dates.at(-1) ?? null,
        people: [...new Set(children.flatMap((t) => [t.assigneeId, t.secondaryAssigneeId]).filter((id): id is number => id !== null))],
      };
    });
  }, [allTasks, tasks, categoryOf, today, search]);

  const totals = stats.reduce((t, s) => ({ tasks: t.tasks + s.children.length, done: t.done + s.done, risky: t.risky + (s.overdue > 0 ? 1 : 0) }), { tasks: 0, done: 0, risky: 0 });
  const loose = tasks.filter((t) => t.type !== "epic" && t.epicId === null).length;

  if (allTasks.every((t) => t.type !== "epic")) {
    return (
      <EmptyState
        icon={Layers}
        title="No epics yet. An epic groups related tasks, such as everything for Christmas services, and shows how far along they are."
        action={
          canEdit && (
            <Button icon={Plus} onClick={onNewEpic}>
              New epic
            </Button>
          )
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Epics" value={stats.length} />
        <Tile label="Tasks in epics" value={totals.tasks} />
        <Tile label="Done" value={totals.tasks ? `${Math.round((totals.done / totals.tasks) * 100)}%` : "—"} />
        <Tile label="Epics with overdue work" value={totals.risky} tone={totals.risky > 0 ? "danger" : undefined} />
      </dl>
      <ul className="flex flex-col gap-3">
        {stats.map((s) => (
          <EpicCard key={s.epic.id} stats={s} states={states} people={people} today={today} categoryOf={categoryOf} onOpen={onOpen} />
        ))}
      </ul>
      {loose > 0 && <p className="text-secondary text-ink-2">{loose === 1 ? "1 task isn't" : `${loose} tasks aren't`} in an epic.</p>}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" }) {
  return (
    <div className="rounded-card border border-line bg-card p-4 shadow-raised">
      <dt className="text-caption text-ink-2">{label}</dt>
      <dd className={cn("text-large-title tabular-nums", tone === "danger" ? "text-danger-ink" : "text-ink")}>{value}</dd>
    </div>
  );
}

function EpicCard({
  stats,
  states,
  people,
  today,
  categoryOf,
  onOpen,
}: {
  stats: EpicStats;
  states: WorkflowState[];
  people: Map<number, Person>;
  today: string;
  categoryOf: Map<number, Category>;
  onOpen: (task: TaskCard) => void;
}) {
  const [open, setOpen] = useState(false);
  const { epic, children, done, started, todo, overdue, unassigned, firstDue, lastDue } = stats;
  const total = children.length;
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  const tones = columnTones(states);
  const state = states.find((s) => s.id === epic.stateId);
  const listId = `epic-${epic.id}-tasks`;
  return (
    <li className="overflow-hidden rounded-card border border-line bg-card shadow-raised">
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-2 text-label font-semibold text-ink-2 tabular-nums">
            <Icon icon={Layers} size="sm" className="text-project-purple" />
            {epic.key}
            {state && <StatusPill name={state.name} tone={tones.get(state.id) ?? "grey"} />}
            <PriorityPill priority={epic.priority} />
          </span>
          <button type="button" onClick={() => onOpen(epic)} className="min-h-touch truncate text-left text-body font-semibold text-ink state-hover:underline">
            {epic.title}
          </button>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-2">
            {firstDue ? (
              <span className="tabular-nums">
                Due {formatDate(firstDue)}
                {lastDue && lastDue !== firstDue && ` – ${formatDate(lastDue, lastDue.slice(0, 4) !== today.slice(0, 4))}`}
              </span>
            ) : (
              <span>No due dates</span>
            )}
            {epic.dueDate && <DueBadge dueDate={epic.dueDate} today={today} done={categoryOf.get(epic.stateId) === "done"} />}
            {overdue > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-danger-ink">
                <Icon icon={CircleAlert} size="sm" />
                {overdue} overdue
              </span>
            )}
            {unassigned > 0 && <span>{unassigned} unassigned</span>}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 md:w-80">
          <div className="flex items-baseline justify-between gap-2 text-caption text-ink-2">
            <span>
              <span className="text-secondary font-semibold text-ink tabular-nums">{total ? Math.round(pct(done)) : 0}%</span> done
            </span>
            <span className="tabular-nums">
              {done} of {total} {total === 1 ? "task" : "tasks"}
            </span>
          </div>
          {/* Progress split by category; the numbers beside it carry the meaning (section 13). */}
          <div className="flex h-2.5 overflow-hidden rounded-pill bg-hover" role="img" aria-label={`${done} done, ${started} in progress, ${todo} to do`}>
            <span className="bg-vivid-green" style={{ width: `${pct(done)}%` }} />
            <span className="bg-vivid-orange" style={{ width: `${pct(started)}%` }} />
            <span className="bg-line-strong" style={{ width: `${pct(todo)}%` }} />
          </div>
          <span className="flex gap-3 text-caption text-ink-2 tabular-nums">
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="size-2 rounded-full bg-vivid-green" />
              {done} done
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="size-2 rounded-full bg-vivid-orange" />
              {started} in progress
            </span>
            <span className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="size-2 rounded-full bg-line-strong" />
              {todo} to do
            </span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 md:w-40 md:justify-end">
          <span className="inline-flex">
            <span className="sr-only">{stats.people.length === 1 ? "1 person" : `${stats.people.length} people`} on this epic</span>
            {stats.people.slice(0, 4).map((id, i) => {
              const p = people.get(id);
              return p ? <Avatar key={id} name={p.name} url={p.avatarUrl} size="xs" className={cn("ring-2 ring-card", i > 0 && "-ml-1.5")} /> : null;
            })}
            {stats.people.length > 4 && <span className="ml-1 text-caption text-ink-2">+{stats.people.length - 4}</span>}
          </span>
          <Button variant="ghost" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((o) => !o)} disabled={total === 0}>
            <Icon icon={ChevronDown} size="sm" className={cn("transition-transform duration-(--duration-menu) ease-out", open && "rotate-180")} />
            {open ? "Hide tasks" : "Tasks"}
          </Button>
        </div>
      </div>
      {open && (
        <ul id={listId} className="flex flex-col divide-y divide-line border-t border-line bg-page">
          {children.map((t) => {
            const s = states.find((x) => x.id === t.stateId);
            const assignee = t.assigneeId !== null ? people.get(t.assigneeId) : undefined;
            return (
              <li key={t.id} className="flex min-h-11 items-center gap-3 px-4 py-1.5">
                <span className="inline-flex shrink-0 items-center gap-1 text-label font-semibold text-ink-2 tabular-nums">
                  <TypeIcon type={t.type} />
                  {t.key}
                </span>
                <button type="button" onClick={() => onOpen(t)} className="min-h-touch min-w-0 flex-1 truncate text-left text-secondary text-ink state-hover:underline">
                  {t.title}
                </button>
                <DueBadge dueDate={t.dueDate} today={today} done={categoryOf.get(t.stateId) === "done"} />
                {s && <StatusPill name={s.name} tone={tones.get(s.id) ?? "grey"} className="hidden min-w-24 sm:inline-flex" />}
                {assignee ? (
                  <span className="inline-flex" title={assignee.name}>
                    <Avatar name={assignee.name} url={assignee.avatarUrl} size="xs" />
                    <span className="sr-only">Assigned to {assignee.name}</span>
                  </span>
                ) : (
                  <span className="size-6">
                    <span className="sr-only">Unassigned</span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
