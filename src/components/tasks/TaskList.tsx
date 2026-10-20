import { CircleCheck, EllipsisVertical, UserRoundPen } from "lucide-react";
import { Checkbox as RadixCheckbox } from "radix-ui";
import { Check } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useMemo, useRef, useState } from "react";
import { type Label, type Member, type Person, PRIORITIES, type TaskCard, type WorkflowState } from "../../../shared/tasks";
import { cn } from "../../lib/cn";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "../ui/Menu";
import { SortIcon, type SortState } from "../ui/Table";
import { DueBadge, LabelChip, PriorityIndicator, TypeIcon } from "./bits";
import { columnTones, PriorityPill, StatusPill } from "./tones";

// List view (TASK-2: sort and filter) with multi-select for bulk edit (TASK-10). On phones each row can be
// swiped right to mark it complete or left to reassign (TASK-12); the row's menu offers the same two actions.

export type ListProps = {
  states: WorkflowState[];
  tasks: TaskCard[];
  labels: Map<number, Label>;
  people: Map<number, Person>;
  assignable: Member[];
  today: string;
  canEdit: boolean;
  selected: Set<number>;
  onSelectedChange: (ids: Set<number>) => void;
  onOpen: (task: TaskCard) => void;
  onComplete: (task: TaskCard) => void;
  onReassign: (task: TaskCard, assigneeId: number | null) => void;
};

type SortKey = "key" | "title" | "status" | "priority" | "due" | "assignee";

const SORT_HEADERS: { key: SortKey; header: string }[] = [
  { key: "key", header: "Key" },
  { key: "title", header: "Title" },
  { key: "status", header: "Status" },
  { key: "assignee", header: "Assignee" },
  { key: "priority", header: "Priority" },
  { key: "due", header: "Due" },
];

function SmallCheckbox({ checked, onChange, label }: { checked: boolean | "indeterminate"; onChange: (v: boolean) => void; label: string }) {
  return (
    <RadixCheckbox.Root
      checked={checked}
      onCheckedChange={(v) => onChange(v === true)}
      aria-label={label}
      className={cn(
        "relative inline-flex size-5 shrink-0 items-center justify-center rounded-chip border border-line-strong bg-card text-on-accent",
        "after:absolute after:-inset-3 after:content-[''] state-hover:border-ink-2",
        "data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
      )}
    >
      <RadixCheckbox.Indicator>
        <Icon icon={Check} size="sm" />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}

export function TaskList(props: ListProps) {
  const { states, tasks, labels, people, today, canEdit, selected, onSelectedChange, onOpen } = props;
  const [sort, setSort] = useState<SortState>({ key: "key", direction: "descending" });
  const statePos = useMemo(() => new Map(states.map((s) => [s.id, s.position])), [states]);
  const stateName = useMemo(() => new Map(states.map((s) => [s.id, s.name])), [states]);
  const doneStates = useMemo(() => new Set(states.filter((s) => s.category === "done").map((s) => s.id)), [states]);
  const tones = useMemo(() => columnTones(states), [states]);

  const rows = useMemo(() => {
    const value = (t: TaskCard): string | number => {
      switch (sort.key as SortKey) {
        case "key":
          return t.number;
        case "title":
          return t.title.toLowerCase();
        case "status":
          return statePos.get(t.stateId) ?? 0;
        case "priority":
          return PRIORITIES.indexOf(t.priority);
        case "due":
          // No due date sorts last either way.
          return t.dueDate ?? (sort.direction === "ascending" ? "9999" : "0000");
        case "assignee":
          return t.assigneeId !== null ? (people.get(t.assigneeId)?.name.toLowerCase() ?? "") : "~";
      }
    };
    const dir = sort.direction === "ascending" ? 1 : -1;
    return [...tasks].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return va < vb ? -dir : va > vb ? dir : b.number - a.number;
    });
  }, [tasks, sort, statePos, people]);

  const allSelected = rows.length > 0 && rows.every((t) => selected.has(t.id));
  const someSelected = rows.some((t) => selected.has(t.id));
  const toggle = (id: number, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onSelectedChange(next);
  };

  return (
    <>
      {/* Tablet and desktop: a sortable table. */}
      <div className="hidden overflow-x-auto rounded-card border border-line bg-card md:block">
        <table className="w-full border-collapse text-left text-secondary">
          <caption className="sr-only">Tasks</caption>
          <thead>
            <tr className="border-b border-line">
              {canEdit && (
                <th scope="col" className="w-0 px-4 py-2">
                  <SmallCheckbox
                    label="Select all tasks"
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onChange={(on) => onSelectedChange(on ? new Set(rows.map((t) => t.id)) : new Set())}
                  />
                </th>
              )}
              {SORT_HEADERS.map((h) => {
                const active = sort.key === h.key ? sort.direction : undefined;
                return (
                  <th key={h.key} scope="col" aria-sort={active ?? "none"} className="px-3 py-2 text-label text-ink-2">
                    <button
                      type="button"
                      onClick={() => setSort({ key: h.key, direction: active === "ascending" ? "descending" : "ascending" })}
                      className={cn(
                        "-mx-2 inline-flex min-h-touch items-center gap-1 rounded-chip px-2 state-hover:bg-hover state-hover:text-ink",
                        active && "text-ink",
                      )}
                    >
                      {h.header}
                      <SortIcon direction={active} />
                    </button>
                  </th>
                );
              })}
              <th scope="col" className="px-3 py-2 text-label text-ink-2">
                Labels
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const assignee = t.assigneeId !== null ? people.get(t.assigneeId) : undefined;
              return (
                <tr
                  key={t.id}
                  className={cn(
                    "border-b border-line transition-colors duration-(--duration-micro) ease-out last:border-b-0 state-hover:bg-hover",
                    selected.has(t.id) && "bg-accent-soft",
                  )}
                >
                  {canEdit && (
                    <td className="px-4 py-2">
                      <SmallCheckbox label={`Select ${t.key}`} checked={selected.has(t.id)} onChange={(on) => toggle(t.id, on)} />
                    </td>
                  )}
                  <td className="px-3 py-2 whitespace-nowrap text-ink-2 tabular-nums">
                    <span className="inline-flex items-center gap-1.5">
                      <TypeIcon type={t.type} />
                      {t.key}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => onOpen(t)} className="min-h-touch text-left font-medium text-ink underline-offset-4 hover:underline">
                      {t.title}
                    </button>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <StatusPill name={stateName.get(t.stateId) ?? ""} tone={tones.get(t.stateId) ?? "grey"} className="min-w-24" />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {assignee ? (
                      <span className="inline-flex items-center gap-2">
                        <Avatar name={assignee.name} url={assignee.avatarUrl} size="sm" />
                        {assignee.name}
                      </span>
                    ) : (
                      <span className="text-ink-2">Unassigned</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <PriorityPill priority={t.priority} className="min-w-20" />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <DueBadge dueDate={t.dueDate} today={today} done={doneStates.has(t.stateId)} />
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {t.labelIds.map((id) => labels.get(id)).map((l) => l && <LabelChip key={l.id} label={l} />)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phones: one row per task, with swipe shortcuts and a menu holding the same actions. */}
      <ul className="flex flex-col gap-2 md:hidden" aria-label="Tasks">
        {rows.map((t) => (
          <SwipeRow key={t.id} task={t} {...props} done={doneStates.has(t.stateId)} statusName={stateName.get(t.stateId) ?? ""} />
        ))}
      </ul>
    </>
  );
}

const SWIPE_THRESHOLD = 80;

function SwipeRow({
  task,
  people,
  labels,
  today,
  canEdit,
  done,
  statusName,
  assignable,
  selected,
  onSelectedChange,
  onOpen,
  onComplete,
  onReassign,
}: ListProps & { task: TaskCard; done: boolean; statusName: string }) {
  const [dx, setDx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  // A left swipe opens the menu straight at "Reassign to".
  const [reassignOnly, setReassignOnly] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiping = useRef(false);
  const assignee = task.assigneeId !== null ? people.get(task.assigneeId) : undefined;

  function onPointerDown(e: ReactPointerEvent) {
    if (!canEdit || e.pointerType !== "touch") return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swiping.current = false;
  }
  function onPointerMove(e: ReactPointerEvent) {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const x = e.clientX - s.x;
    const y = e.clientY - s.y;
    // Vertical movement is scrolling, not a swipe.
    if (!swiping.current && Math.abs(y) > Math.abs(x)) {
      start.current = null;
      return;
    }
    if (Math.abs(x) > 8) swiping.current = true;
    if (swiping.current) setDx(Math.max(-120, Math.min(120, x)));
  }
  function onPointerUp() {
    if (dx >= SWIPE_THRESHOLD && !done) onComplete(task);
    if (dx <= -SWIPE_THRESHOLD) {
      setReassignOnly(true);
      setMenuOpen(true);
    }
    start.current = null;
    setDx(0);
  }

  return (
    <li className="relative overflow-hidden rounded-control">
      {/* What the swipe will do, revealed behind the row. */}
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-between px-4 text-label">
        <span className={cn("inline-flex items-center gap-1 text-success-ink", dx <= 0 && "invisible")}>
          <Icon icon={CircleCheck} size="sm" /> Complete
        </span>
        <span className={cn("inline-flex items-center gap-1 text-accent-ink", dx >= 0 && "invisible")}>
          Reassign <Icon icon={UserRoundPen} size="sm" />
        </span>
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null;
          setDx(0);
        }}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, touchAction: "pan-y" }}
        className={cn(
          "relative flex items-start gap-3 border border-line bg-card p-3",
          !dx && "transition-transform duration-(--duration-micro) ease-out",
          selected.has(task.id) && "bg-accent-soft",
        )}
      >
        {canEdit && (
          <span className="pt-1">
            <SmallCheckbox
              label={`Select ${task.key}`}
              checked={selected.has(task.id)}
              onChange={(on) => {
                const next = new Set(selected);
                if (on) next.add(task.id);
                else next.delete(task.id);
                onSelectedChange(next);
              }}
            />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-center gap-1.5 text-label text-ink-2 tabular-nums">
            <TypeIcon type={task.type} />
            {task.key} · {statusName}
          </span>
          <button
            type="button"
            onClick={() => !swiping.current && onOpen(task)}
            className="min-h-touch text-left text-secondary font-medium text-ink"
          >
            {task.title}
          </button>
          <span className="flex flex-wrap items-center gap-2">
            <PriorityIndicator priority={task.priority} />
            <DueBadge dueDate={task.dueDate} today={today} done={done} />
            {task.labelIds.slice(0, 2).map((id) => {
              const l = labels.get(id);
              return l && <LabelChip key={id} label={l} />;
            })}
            <span className="ml-auto text-label text-ink-2">{assignee ? assignee.name : "Unassigned"}</span>
          </span>
        </div>
        {canEdit && (
          <Menu
            open={menuOpen}
            onOpenChange={(open) => {
              setMenuOpen(open);
              if (!open) setReassignOnly(false);
            }}
          >
            <MenuTrigger asChild>
              <Button variant="ghost" iconOnly icon={EllipsisVertical} aria-label={`Actions for ${task.key}`} />
            </MenuTrigger>
            <MenuContent>
              {!reassignOnly && (
                <>
                  <MenuItem icon={CircleCheck} disabled={done} onSelect={() => onComplete(task)}>
                    Mark complete
                  </MenuItem>
                  <MenuSeparator />
                </>
              )}
              <MenuLabel>Reassign to</MenuLabel>
              {assignable.map((m) => (
                <MenuItem key={m.id} disabled={m.id === task.assigneeId} onSelect={() => onReassign(task, m.id)}>
                  {m.name}
                </MenuItem>
              ))}
              <MenuItem disabled={task.assigneeId === null} onSelect={() => onReassign(task, null)}>
                Unassigned
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </div>
    </li>
  );
}
