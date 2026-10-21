import {
  type Announcements,
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowRightLeft, Check } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import type { Label, Person, TaskCard, WorkflowState } from "../../../shared/tasks";
import { cn } from "../../lib/cn";
import { columnCards } from "../../lib/tasks";
import { OfflineDisabled } from "../StatusBanners";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "../ui/Menu";
import { BlockedNote, DueBadge, LabelChip, SubtaskProgress, TypeIcon } from "./bits";
import { columnTones, PriorityPill, VIVID_CLASSES, type Vivid } from "./tones";

// The project board (section 11.2, TASK-2). Drag and drop with dnd-kit on pointer and touch; every card also
// has a Move button that opens a column picker, the keyboard and screen-reader alternative (NFR-13).
// On phones one column fills the screen and columns swipe sideways (scroll snap), with tabs to jump.

export type BoardProps = {
  states: WorkflowState[];
  /** Already filtered. */
  tasks: TaskCard[];
  labels: Map<number, Label>;
  people: Map<number, Person>;
  today: string;
  canMove: boolean;
  /** Could move but offline: Move buttons show disabled with the reason (section 11.10). */
  offline?: boolean;
  onOpen: (task: TaskCard) => void;
  onMove: (input: { task: TaskCard; stateId: number; afterId: number | null; beforeId: number | null }) => void;
};

type Columns = Record<number, number[]>;

/** A dot in the workflow category's colour beside each column name (the name carries the meaning). */
export const CATEGORY_DOT: Record<WorkflowState["category"], string> = {
  todo: "bg-status-todo",
  in_progress: "bg-status-progress",
  done: "bg-status-done",
};

const COLUMN_PREFIX = "column-";

export function Board({ states, tasks, labels, people, today, canMove, offline = false, onOpen, onMove }: BoardProps) {
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const derived = useMemo<Columns>(
    () => Object.fromEntries(states.map((s) => [s.id, columnCards(tasks, s.id).map((t) => t.id)])),
    [states, tasks],
  );
  // While dragging, cards live in this local copy so they can move between columns before the drop.
  const [dragColumns, setDragColumns] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const columns = dragColumns ?? derived;
  const doneStates = useMemo(() => new Set(states.filter((s) => s.category === "done").map((s) => s.id)), [states]);
  const stateName = (id: number) => states.find((s) => s.id === id)?.name ?? "";
  const tones = useMemo(() => columnTones(states), [states]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Touch: press and hold, so a normal swipe still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const containerOf = (id: number | string, cols: Columns): number | null => {
    if (typeof id === "string" && id.startsWith(COLUMN_PREFIX)) return Number(id.slice(COLUMN_PREFIX.length));
    for (const [stateId, ids] of Object.entries(cols)) if (ids.includes(Number(id))) return Number(stateId);
    return null;
  };

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(Number(active.id));
    setDragColumns(derived);
  }

  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over || !dragColumns) return;
    const from = containerOf(active.id, dragColumns);
    const to = containerOf(over.id, dragColumns);
    if (from === null || to === null || from === to) return;
    const id = Number(active.id);
    const target = dragColumns[to]!.filter((x) => x !== id);
    const overIndex = target.indexOf(Number(over.id));
    target.splice(overIndex >= 0 ? overIndex : target.length, 0, id);
    setDragColumns({ ...dragColumns, [from]: dragColumns[from]!.filter((x) => x !== id), [to]: target });
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    lastDrop.current = Date.now();
    const cols = dragColumns;
    setActiveId(null);
    setDragColumns(null);
    if (!over || !cols) return;
    const id = Number(active.id);
    const stateId = containerOf(active.id, cols);
    if (stateId === null) return;
    let list = cols[stateId]!;
    const overIndex = list.indexOf(Number(over.id));
    const fromIndex = list.indexOf(id);
    if (overIndex >= 0 && overIndex !== fromIndex) {
      list = [...list];
      list.splice(fromIndex, 1);
      list.splice(overIndex, 0, id);
    }
    const index = list.indexOf(id);
    const task = byId.get(id)!;
    const original = derived[task.stateId] ?? [];
    // Dropped where it started: nothing to do.
    if (stateId === task.stateId && original.indexOf(id) === index) return;
    onMove({ task, stateId, afterId: list[index - 1] ?? null, beforeId: list[index + 1] ?? null });
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${byId.get(Number(active.id))?.key ?? "task"}.`,
    onDragOver: ({ over }) => (over ? `Over ${stateName(containerOf(over.id, columns) ?? 0)}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over ? `Moved ${byId.get(Number(active.id))?.key ?? "task"} to ${stateName(containerOf(over.id, columns) ?? 0)}.` : "Move cancelled.",
    onDragCancel: () => "Move cancelled.",
  };

  const active = activeId !== null ? byId.get(activeId) : undefined;
  // A drop can end with a click on the card underneath; that click shouldn't open the task.
  const lastDrop = useRef(0);
  const open = (task: TaskCard) => {
    if (Date.now() - lastDrop.current > 250) onOpen(task);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Phones: jump between columns (section 12: one column visible, swipe to switch). */}
      <nav aria-label="Columns" className="-mx-4 flex gap-2 overflow-x-auto px-4 md:hidden">
        {states.map((s) => (
          <button
            key={s.id}
            type="button"
            className="inline-flex min-h-touch shrink-0 items-center gap-2 rounded-full border border-line-strong bg-card px-4 text-secondary text-ink state-hover:bg-hover"
            onClick={() => document.getElementById(`board-column-${s.id}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" })}
          >
            <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", VIVID_CLASSES[tones.get(s.id) ?? "grey"].bg)} />
            {s.name} <span className="text-ink-2 tabular-nums">{columns[s.id]?.length ?? 0}</span>
          </button>
        ))}
      </nav>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setDragColumns(null);
        }}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: "To move this task with the keyboard, use its Move button." },
        }}
      >
        <div
          // relative: absolutely positioned descendants (screen-reader text) stay inside this scroller instead of
          // widening the page (section 12: only the board scrolls sideways).
          className="relative -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 md:mx-0 md:snap-none md:px-0"
          role="region"
          aria-label="Board"
        >
          {states.map((state) => (
            <Column
              key={state.id}
              state={state}
              tone={tones.get(state.id) ?? "grey"}
              ids={columns[state.id] ?? []}
              byId={byId}
              labels={labels}
              people={people}
              today={today}
              states={states}
              canMove={canMove}
              offline={offline}
              done={doneStates.has(state.id)}
              activeId={activeId}
              onOpen={open}
              onMoveTo={(task, stateId) => onMove({ task, stateId, afterId: null, beforeId: null })}
            />
          ))}
        </div>
        <DragOverlay>
          {active && (
            <CardBody task={active} labels={labels} people={people} today={today} done={doneStates.has(active.stateId)} tone={tones.get(active.stateId) ?? "grey"} className="shadow-modal" />
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

type ColumnProps = {
  state: WorkflowState;
  tone: Vivid;
  ids: number[];
  byId: Map<number, TaskCard>;
  labels: Map<number, Label>;
  people: Map<number, Person>;
  today: string;
  states: WorkflowState[];
  canMove: boolean;
  offline: boolean;
  done: boolean;
  activeId: number | null;
  onOpen: (task: TaskCard) => void;
  onMoveTo: (task: TaskCard, stateId: number) => void;
};

function Column({ state, tone, ids, byId, labels, people, today, states, canMove, offline, done, activeId, onOpen, onMoveTo }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_PREFIX}${state.id}`, disabled: !canMove });
  const headingId = `board-column-${state.id}-title`;
  return (
    <section
      id={`board-column-${state.id}`}
      aria-labelledby={headingId}
      className="relative flex w-[calc(100vw-2rem)] shrink-0 snap-start flex-col overflow-hidden rounded-card bg-column md:w-72"
    >
      {/* The column's colour as a solid header band, like a monday.com group. */}
      <h2 id={headingId} className={cn("flex items-center gap-2 px-3 py-2 text-secondary font-semibold text-on-vivid", VIVID_CLASSES[tone].bg)}>
        <span className="min-w-0 flex-1 truncate">{state.name}</span>
        {/* Section 11.2: open-task count in the header. */}
        <span className="rounded-pill border border-on-vivid/60 px-1.5 text-label font-semibold text-on-vivid tabular-nums">
          <span className="sr-only">{ids.length === 1 ? "1 task" : `${ids.length} tasks`}</span>
          <span aria-hidden="true">{ids.length}</span>
        </span>
      </h2>
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={!canMove}>
        <ol
          ref={setNodeRef}
          className={cn(
            "flex min-h-24 flex-1 flex-col gap-2 rounded-b-card p-2 transition-colors duration-(--duration-micro) ease-out",
            isOver && "bg-accent-soft outline-2 -outline-offset-4 outline-accent outline-dashed",
          )}
        >
          {ids.map((id) => {
            const task = byId.get(id);
            if (!task) return null;
            return (
              <SortableCard
                key={id}
                task={task}
                tone={tone}
                labels={labels}
                people={people}
                today={today}
                states={states}
                canMove={canMove}
                offline={offline}
                done={done}
                dragging={activeId === id}
                onOpen={onOpen}
                onMoveTo={onMoveTo}
              />
            );
          })}
        </ol>
      </SortableContext>
    </section>
  );
}

type CardProps = {
  task: TaskCard;
  tone: Vivid;
  labels: Map<number, Label>;
  people: Map<number, Person>;
  today: string;
  states: WorkflowState[];
  canMove: boolean;
  offline: boolean;
  done: boolean;
  dragging: boolean;
  onOpen: (task: TaskCard) => void;
  onMoveTo: (task: TaskCard, stateId: number) => void;
};

const SortableCard = memo(function SortableCard({ task, tone, labels, people, today, states, canMove, offline, done, dragging, onOpen, onMoveTo }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id, disabled: !canMove });
  // The keyboard alternative is the Move button, so the card itself isn't a dnd-kit keyboard target.
  const { role: _role, tabIndex: _tabIndex, ...dragAttributes } = attributes;
  return (
    <li
      ref={setNodeRef}
      data-task-id={task.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", dragging && "opacity-40")}
      {...dragAttributes}
      {...listeners}
    >
      <CardBody task={task} labels={labels} people={people} today={today} done={done} tone={tone} onOpen={() => onOpen(task)} />
      {(canMove || offline) && (
        <div className="absolute top-1 right-1">
          {canMove ? <MoveMenu task={task} states={states} onMoveTo={onMoveTo} /> : <OfflineDisabled label={`Move ${task.key}`} icon={ArrowRightLeft} iconOnly />}
        </div>
      )}
    </li>
  );
});

function MoveMenu({ task, states, onMoveTo }: { task: TaskCard; states: WorkflowState[]; onMoveTo: (task: TaskCard, stateId: number) => void }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" iconOnly icon={ArrowRightLeft} aria-label={`Move ${task.key}`} className="size-touch text-ink-2" />
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Move {task.key} to</MenuLabel>
        {states.map((s) => (
          <MenuItem key={s.id} disabled={s.id === task.stateId} icon={s.id === task.stateId ? Check : undefined} onSelect={() => onMoveTo(task, s.id)}>
            {s.name}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

type CardBodyProps = {
  task: TaskCard;
  labels: Map<number, Label>;
  people: Map<number, Person>;
  today: string;
  done: boolean;
  /** The column's colour, shown as the card's left edge. */
  tone: Vivid;
  onOpen?: () => void;
  className?: string;
};

/** Key, title, assignee avatar, due date, priority and at most 2 label chips (section 11.2). */
export function CardBody({ task, labels, people, today, done, tone, onOpen, className }: CardBodyProps) {
  const assignee = task.assigneeId !== null ? people.get(task.assigneeId) : undefined;
  const secondary = task.secondaryAssigneeId !== null ? people.get(task.secondaryAssigneeId) : undefined;
  const cardLabels = task.labelIds.map((id) => labels.get(id)).filter((l): l is Label => !!l);
  return (
    <article className={cn("lift flex flex-col gap-2 rounded-control border border-l-4 border-line bg-card p-2.5 shadow-raised", VIVID_CLASSES[tone].edge, className)}>
      <h3 className="pr-9 text-secondary font-medium text-ink">
        {onOpen ? (
          // The whole card is the open target; the button stretches over it (the Move button sits above).
          <button type="button" onClick={onOpen} className="text-left after:absolute after:inset-0 after:rounded-control after:content-['']">
            {task.title}
          </button>
        ) : (
          task.title
        )}
      </h3>
      {task.blockedReason !== null && <BlockedNote reason={task.blockedReason} />}
      {cardLabels.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {cardLabels.slice(0, 2).map((l) => (
            <LabelChip key={l.id} label={l} />
          ))}
          {cardLabels.length > 2 && <span className="text-label text-ink-2">+{cardLabels.length - 2}</span>}
        </span>
      )}
      <span className="flex items-end gap-2">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("inline-flex items-center gap-1 text-label font-semibold text-ink-2", done && "line-through")}>
            <TypeIcon type={task.type} />
            <span className="tabular-nums">{task.key}</span>
          </span>
          <DueBadge dueDate={task.dueDate} today={today} done={done} />
          <SubtaskProgress done={task.subtasksDone} total={task.subtasksTotal} />
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5">
          <PriorityPill priority={task.priority} />
          {assignee ? (
            <span className="inline-flex" title={secondary ? `${assignee.name} and ${secondary.name}` : assignee.name}>
              <Avatar name={assignee.name} url={assignee.avatarUrl} size="xs" className="ring-2 ring-card" />
              {secondary && <Avatar name={secondary.name} url={secondary.avatarUrl} size="xs" className="-ml-1.5 ring-2 ring-card" />}
              <span className="sr-only">
                Assigned to {assignee.name}
                {secondary && `, with ${secondary.name}`}
              </span>
            </span>
          ) : secondary ? (
            <span className="inline-flex" title={secondary.name}>
              <Avatar name={secondary.name} url={secondary.avatarUrl} size="xs" />
              <span className="sr-only">Secondary assignee {secondary.name}</span>
            </span>
          ) : (
            <span className="sr-only">Unassigned</span>
          )}
        </span>
      </span>
    </article>
  );
}
