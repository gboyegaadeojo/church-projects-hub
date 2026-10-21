import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownToLine, ArrowUpToLine, Check, ChevronDown, EllipsisVertical, GripVertical, Layers, Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router";
import type { Label, Person, TaskCard, WorkflowState } from "../../../shared/tasks";
import { TASK_COPY } from "../../../shared/tasks";
import { cn } from "../../lib/cn";
import { columnCards, useCreateTask } from "../../lib/tasks";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "../ui/Menu";
import { toast } from "../ui/Toast";
import { DueBadge, LabelChip, TypeIcon } from "./bits";
import { columnTones, PriorityPill, StatusPill, type Vivid } from "./tones";

// Backlog (v4.6, after Jira): the work not started yet, one ranked section per "to do" column (e.g. Backlog, then
// To Do as the ready list). Drag a row to reorder it or move it to another section; every row's menu does the same
// from the keyboard (NFR-13). Each section can take a new task straight away. In-progress and done work is
// summarised underneath with a link to the board.

export type BacklogProps = {
  projectId: number;
  projectKey: string;
  csrfToken: string;
  states: WorkflowState[];
  /** Already filtered. */
  tasks: TaskCard[];
  labels: Map<number, Label>;
  people: Map<number, Person>;
  today: string;
  canEdit: boolean;
  onOpen: (task: TaskCard) => void;
  onMove: (input: { task: TaskCard; stateId: number; afterId: number | null; beforeId: number | null }) => void;
};

const SECTION = "section-";

export function BacklogView({ projectId, projectKey, csrfToken, states, tasks, labels, people, today, canEdit, onOpen, onMove }: BacklogProps) {
  const tones = useMemo(() => columnTones(states), [states]);
  const sections = useMemo(() => [...states].filter((s) => s.category === "todo").sort((a, b) => a.position - b.position), [states]);
  const lists = useMemo(() => Object.fromEntries(sections.map((s) => [s.id, columnCards(tasks, s.id)])) as Record<number, TaskCard[]>, [sections, tasks]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const epics = useMemo(() => new Map(tasks.filter((t) => t.type === "epic").map((t) => [t.id, t])), [tasks]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const stateOf = (id: string | number): number | null => {
    if (typeof id === "string" && id.startsWith(SECTION)) return Number(id.slice(SECTION.length));
    return byId.get(Number(id))?.stateId ?? null;
  };

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over) return;
    const task = byId.get(Number(active.id));
    const target = stateOf(over.id);
    if (!task || target === null || !lists[target]) return;
    let list = lists[target]!.map((t) => t.id);
    const overIndex = typeof over.id === "number" ? list.indexOf(over.id) : list.length;
    if (task.stateId === target) {
      const from = list.indexOf(task.id);
      if (from === overIndex || overIndex < 0) return;
      list = arrayMove(list, from, overIndex);
    } else {
      list.splice(overIndex < 0 ? list.length : overIndex, 0, task.id);
    }
    const index = list.indexOf(task.id);
    onMove({ task, stateId: target, afterId: list[index - 1] ?? null, beforeId: list[index + 1] ?? null });
  }

  const others = states.filter((s) => s.category !== "todo");
  const summary = others.map((s) => ({ state: s, count: tasks.filter((t) => t.stateId === s.id).length }));
  const active = activeId !== null ? byId.get(activeId) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }: DragStartEvent) => setActiveId(Number(active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
        accessibility={{ screenReaderInstructions: { draggable: "To move this task with the keyboard, use its menu." } }}
      >
        {sections.map((s) => (
          <Section
            key={s.id}
            state={s}
            tone={tones.get(s.id) ?? "grey"}
            tasks={lists[s.id] ?? []}
            states={states}
            labels={labels}
            people={people}
            epics={epics}
            today={today}
            canEdit={canEdit}
            projectId={projectId}
            csrfToken={csrfToken}
            onOpen={onOpen}
            onMove={onMove}
          />
        ))}
        <DragOverlay>{active && <Row task={active} labels={labels} people={people} epics={epics} today={today} className="shadow-modal" />}</DragOverlay>
      </DndContext>
      {summary.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-card px-4 py-3 text-secondary text-ink-2">
          <span>Already started or finished:</span>
          {summary.map(({ state, count }) => (
            <span key={state.id} className="inline-flex items-center gap-2">
              <StatusPill name={state.name} tone={tones.get(state.id) ?? "grey"} />
              <span className="tabular-nums">{count}</span>
            </span>
          ))}
          <Link to={`/projects/${projectKey}`} className="inline-flex min-h-6 items-center text-accent-ink underline-offset-2 hover:underline">
            Open the board
          </Link>
        </p>
      )}
    </div>
  );
}

type SectionProps = {
  state: WorkflowState;
  tone: Vivid;
  tasks: TaskCard[];
  states: WorkflowState[];
  labels: Map<number, Label>;
  people: Map<number, Person>;
  epics: Map<number, TaskCard>;
  today: string;
  canEdit: boolean;
  projectId: number;
  csrfToken: string;
  onOpen: (task: TaskCard) => void;
  onMove: BacklogProps["onMove"];
};

function Section({ state, tone, tasks, states, labels, people, epics, today, canEdit, projectId, csrfToken, onOpen, onMove }: SectionProps) {
  const [open, setOpen] = useState(true);
  const { setNodeRef, isOver } = useDroppable({ id: `${SECTION}${state.id}`, disabled: !canEdit });
  const headingId = `backlog-${state.id}`;
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-card border border-line bg-card shadow-raised">
      <h2 id={headingId} className="flex items-center gap-3 border-b border-line bg-page px-3 py-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex min-h-touch items-center gap-2 rounded-control px-1 state-hover:bg-hover">
          <Icon icon={ChevronDown} size="sm" className={cn("text-ink-2 transition-transform duration-(--duration-menu) ease-out", !open && "-rotate-90")} />
          <StatusPill name={state.name} tone={tone} />
        </button>
        <span className="text-caption text-ink-2 tabular-nums">{tasks.length === 1 ? "1 task" : `${tasks.length} tasks`}</span>
      </h2>
      {open && (
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy} disabled={!canEdit}>
          <ol ref={setNodeRef} className={cn("flex min-h-12 flex-col divide-y divide-line transition-colors duration-(--duration-micro) ease-out", isOver && "bg-accent-soft")}>
            {tasks.length === 0 && <li className="px-4 py-3 text-secondary text-ink-2">Nothing here. Drag tasks in, or add one below.</li>}
            {tasks.map((t, i) => (
              <SortableRow
                key={t.id}
                task={t}
                labels={labels}
                people={people}
                epics={epics}
                today={today}
                canEdit={canEdit}
                states={states}
                first={i === 0}
                last={i === tasks.length - 1}
                onOpen={onOpen}
                onMoveTo={(stateId, where) => {
                  const ids = tasks.map((x) => x.id).filter((id) => id !== t.id);
                  if (stateId === state.id && where === "top") onMove({ task: t, stateId, afterId: null, beforeId: ids[0] ?? null });
                  else if (stateId === state.id) onMove({ task: t, stateId, afterId: ids.at(-1) ?? null, beforeId: null });
                  else onMove({ task: t, stateId, afterId: null, beforeId: null });
                }}
              />
            ))}
          </ol>
        </SortableContext>
      )}
      {open && canEdit && <QuickAdd projectId={projectId} csrfToken={csrfToken} state={state} />}
    </section>
  );
}

function SortableRow(
  props: Omit<RowProps, "handle" | "actions"> & {
    canEdit: boolean;
    states: WorkflowState[];
    first: boolean;
    last: boolean;
    onMoveTo: (stateId: number, where: "top" | "bottom") => void;
  },
) {
  const { task, canEdit, states, first, last, onMoveTo } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: !canEdit });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn(isDragging && "opacity-40")}>
      <Row
        {...props}
        handle={
          canEdit && (
            <button type="button" aria-label={`Drag ${task.key}`} className="inline-flex size-6 cursor-grab items-center justify-center rounded-chip text-ink-2 state-hover:bg-hover" {...attributes} {...listeners}>
              <Icon icon={GripVertical} size="sm" />
            </button>
          )
        }
        actions={
          canEdit && (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" iconOnly icon={EllipsisVertical} aria-label={`Move ${task.key}`} className="text-ink-2" />
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem icon={ArrowUpToLine} disabled={first} onSelect={() => onMoveTo(task.stateId, "top")}>
                  Move to top
                </MenuItem>
                <MenuItem icon={ArrowDownToLine} disabled={last} onSelect={() => onMoveTo(task.stateId, "bottom")}>
                  Move to bottom
                </MenuItem>
                <MenuSeparator />
                <MenuLabel>Move {task.key} to</MenuLabel>
                {states.map((s) => (
                  <MenuItem key={s.id} disabled={s.id === task.stateId} icon={s.id === task.stateId ? Check : undefined} onSelect={() => onMoveTo(s.id, "bottom")}>
                    {s.name}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )
        }
      />
    </li>
  );
}

type RowProps = {
  task: TaskCard;
  labels: Map<number, Label>;
  people: Map<number, Person>;
  epics: Map<number, TaskCard>;
  today: string;
  onOpen?: (task: TaskCard) => void;
  handle?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

function Row({ task, labels, people, epics, today, onOpen, handle, actions, className }: RowProps) {
  const assignee = task.assigneeId !== null ? people.get(task.assigneeId) : undefined;
  const secondary = task.secondaryAssigneeId !== null ? people.get(task.secondaryAssigneeId) : undefined;
  const epic = task.epicId !== null ? epics.get(task.epicId) : undefined;
  const rowLabels = task.labelIds.map((id) => labels.get(id)).filter((l): l is Label => !!l);
  return (
    // Phones: the title takes its own line under the key and pills, so it never gets squeezed out.
    <div className={cn("flex min-h-12 flex-wrap items-center gap-x-2 bg-card px-2 py-1.5 sm:flex-nowrap sm:px-3", className)}>
      {handle ?? <span className="size-6" />}
      <span className="inline-flex shrink-0 items-center gap-1 text-label font-semibold text-ink-2 tabular-nums">
        <TypeIcon type={task.type} />
        {task.key}
      </span>
      <button
        type="button"
        onClick={() => onOpen?.(task)}
        className="order-last min-h-touch min-w-0 basis-full truncate pl-8 text-left text-secondary text-ink state-hover:underline sm:order-none sm:flex-1 sm:basis-auto sm:pl-0"
      >
        {task.title}
      </button>
      <span className="hidden shrink-0 items-center gap-1.5 md:flex">
        {epic && (
          <span className="inline-flex max-w-40 items-center gap-1 rounded-chip border border-project-purple/40 bg-project-purple/15 px-1.5 py-0.5 text-label text-ink" title={`Epic: ${epic.title}`}>
            <Icon icon={Layers} size="sm" className="text-project-purple" />
            <span className="truncate">{epic.title}</span>
          </span>
        )}
        {rowLabels.slice(0, 2).map((l) => (
          <LabelChip key={l.id} label={l} />
        ))}
      </span>
      <span className="hidden shrink-0 sm:inline">
        <DueBadge dueDate={task.dueDate} today={today} />
      </span>
      <PriorityPill priority={task.priority} className="shrink-0" />
      <span className="ml-auto inline-flex w-12 shrink-0 justify-end sm:ml-0" title={[assignee?.name, secondary?.name].filter(Boolean).join(" and ") || "Unassigned"}>
        {assignee && <Avatar name={assignee.name} url={assignee.avatarUrl} size="xs" className="ring-2 ring-card" />}
        {secondary && <Avatar name={secondary.name} url={secondary.avatarUrl} size="xs" className="-ml-1.5 ring-2 ring-card" />}
        <span className="sr-only">{assignee ? `Assigned to ${assignee.name}${secondary ? `, with ${secondary.name}` : ""}` : "Unassigned"}</span>
      </span>
      {actions}
    </div>
  );
}

function QuickAdd({ projectId, csrfToken, state }: { projectId: number; csrfToken: string; state: WorkflowState }) {
  const create = useCreateTask(projectId, csrfToken);
  const [title, setTitle] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const task = await create.mutateAsync({ title: title.trim(), stateId: state.id });
      setTitle("");
      toast({ variant: "success", title: `${task.key} created.` });
    } catch {
      toast({ variant: "error", title: TASK_COPY.saveFailed });
    }
  }
  return (
    <form onSubmit={submit} className="flex items-center gap-2 border-t border-line px-3 py-2">
      <Icon icon={Plus} size="sm" className="text-ink-2" />
      <label className="flex-1">
        <span className="sr-only">New task in {state.name}</span>
        <input
          value={title}
          maxLength={200}
          placeholder={`Add a task to ${state.name}`}
          onChange={(e) => setTitle(e.target.value)}
          className="min-h-touch w-full rounded-control border border-transparent bg-transparent px-2 text-secondary text-ink placeholder:text-ink-2 state-hover:border-line focus:border-line-strong"
        />
      </label>
      {title.trim() && (
        <Button type="submit" loading={create.isPending}>
          Add
        </Button>
      )}
    </form>
  );
}
