import { ArrowLeft, Bell, BellOff, Plus, RefreshCw, SearchX, Tag, Trash2, TriangleAlert } from "lucide-react";
import { type ComponentProps, type FormEvent, lazy, type ReactNode, Suspense, useEffect, useId, useRef, useState } from "react";
import type { MeResponse } from "../../../shared/auth";
import type { ProjectSummary } from "../../../shared/projects";
import type { RichTextDoc } from "../../../shared/richtext";
import {
  type BoardResponse,
  type Comment,
  type Person,
  PRIORITIES,
  PRIORITY_LABELS,
  SCOPE_LABELS,
  SCOPES,
  TASK_CONFIRM,
  TASK_COPY,
  TASK_TYPE_LABELS,
  TASK_TYPES,
  type TaskDetail,
  type TaskEvent,
  todayIn,
  type UpdateTaskBody,
} from "../../../shared/tasks";
import { ApiError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { TaskConflict, useComments, useDeleteTask, useSubtasks, useTaskDetail, useUpdateTask, useWatch } from "../../lib/taskDetail";
import { peopleById } from "../../lib/tasks";
import { Avatar } from "../ui/Avatar";
import { Button, IconButton } from "../ui/Button";
import { Checkbox, Select } from "../ui/choices";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Dialog, SheetContent } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { DateInput, Textarea, TextInput } from "../ui/inputs";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Menu";
import { Skeleton } from "../ui/Skeleton";
import { EmptyState, ErrorState } from "../ui/States";
import { toast } from "../ui/Toast";
import { AttachmentSection } from "./Attachments";
import { DueBadge, formatDate, LabelChip } from "./bits";
import { isEmptyDoc, RichTextView } from "./RichTextView";

// Task detail (section 11.3): a sheet over the board from 768 px, full screen on phones (Back and swipe down
// return to the board). Inline editing, no edit mode: each field saves on change with "Saved ✓" once the server
// confirms. A conflicting change shows the section 14 conflict copy and the latest version to review (NFR-10).

const NONE = "none";
const OWN_DELETE_MS = 24 * 60 * 60 * 1000;

export type TaskDetailSheetProps = {
  taskKey: string;
  board: BoardResponse;
  project: ProjectSummary;
  me: MeResponse;
  canEdit: boolean;
  onClose: () => void;
};

export function TaskDetailSheet({ taskKey, board, project, me, canEdit, onClose }: TaskDetailSheetProps) {
  const query = useTaskDetail(taskKey);
  const swipe = useRef<number | null>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        title={query.data ? query.data.key : taskKey.toUpperCase()}
        className="max-md:h-dvh max-md:max-h-dvh max-md:rounded-none md:max-w-3xl"
        // Phones: a downward swipe from the top of the sheet goes back to the board.
        onTouchStart={(e) => {
          const y = e.touches[0]?.clientY ?? 0;
          swipe.current = y < 140 ? y : null;
        }}
        onTouchEnd={(e) => {
          const start = swipe.current;
          swipe.current = null;
          if (start !== null && (e.changedTouches[0]?.clientY ?? 0) - start > 120) onClose();
        }}
      >
        <Button variant="ghost" icon={ArrowLeft} onClick={onClose} className="-mt-2 mb-2 md:hidden">
          Back to board
        </Button>
        {query.isPending ? (
          <div aria-busy="true" aria-label="Loading task" className="flex flex-col gap-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : query.isError ? (
          query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 403) ? (
            <EmptyState icon={SearchX} title="This task doesn't exist or was deleted." />
          ) : (
            <ErrorState
              title="We couldn't load this task."
              description="Check your connection and try again."
              onRetry={() => void query.refetch()}
              retrying={query.isFetching}
            />
          )
        ) : (
          <TaskBody task={query.data} board={board} project={project} me={me} canEdit={canEdit} onDeleted={onClose} />
        )}
      </SheetContent>
    </Dialog>
  );
}

function TaskBody({ task, board, project, me, canEdit, onDeleted }: { task: TaskDetail; board: BoardResponse; project: ProjectSummary; me: MeResponse; canEdit: boolean; onDeleted: () => void }) {
  const update = useUpdateTask(me.csrfToken);
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState<{ current: TaskDetail; attempted: Omit<UpdateTaskBody, "version"> } | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const today = todayIn(me.user.timezone);
  const people = peopleById({ members: board.members, people: [...board.people, ...task.people] });
  const assignable = board.members.filter((m) => m.role !== "viewer");
  const done = board.states.find((s) => s.id === task.stateId)?.category === "done";

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  async function save(changes: Omit<UpdateTaskBody, "version">, version = task.version) {
    setSaved(false);
    try {
      await update.mutateAsync({ id: task.id, body: { version, ...changes } as UpdateTaskBody });
      setConflict(null);
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      if (err instanceof TaskConflict) setConflict({ current: err.current, attempted: changes });
      else toast({ variant: "error", title: TASK_COPY.saveFailed });
    }
  }

  const reporter = people.get(task.reporterId);
  const canDelete =
    !project.archived &&
    (me.user.appRole === "admin" ||
      project.role === "admin" ||
      (project.role === "contributor" && task.reporterId === me.user.id && Date.now() - task.createdAt <= OWN_DELETE_MS));

  return (
    <div className="flex flex-col gap-group">
      <div className="flex flex-col gap-2">
        <TitleField task={task} canEdit={canEdit} onSave={(title) => save({ title })} />
        <p className="text-caption text-ink-2" aria-live="polite">
          {update.isPending ? "Saving…" : saved ? TASK_COPY.saved : `Reported by ${reporter?.name ?? "someone"}`}
        </p>
      </div>

      {conflict && (
        <div role="alert" className="flex flex-col gap-3 rounded-control border border-warning-line bg-warning-soft p-3 text-secondary text-ink">
          <p className="flex items-start gap-2">
            <Icon icon={TriangleAlert} className="mt-px text-warning-ink" />
            <span>{TASK_COPY.conflict}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={RefreshCw} onClick={() => setConflict(null)}>
              Keep their changes
            </Button>
            <Button onClick={() => save(conflict.attempted, conflict.current.version)} loading={update.isPending}>
              Save mine over theirs
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-group lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col gap-group">
          <DescriptionSection task={task} people={board.members} canEdit={canEdit} onSave={(doc) => save({ description: doc as never })} />
          <SubtaskSection task={task} canEdit={canEdit} csrfToken={me.csrfToken} />
          <AttachmentSection
            task={task}
            canEdit={canEdit}
            meId={me.user.id}
            isAdmin={me.user.appRole === "admin" || project.role === "admin"}
            csrfToken={me.csrfToken}
          />
          <CommentSection
            task={task}
            me={me}
            people={people}
            mentionable={board.members}
            canComment={!project.archived}
            isAdmin={me.user.appRole === "admin" || project.role === "admin"}
          />
          <ActivitySection task={task} board={board} people={people} timezone={me.user.timezone} />
        </div>

        <aside aria-label="Details" className="flex flex-col gap-4 lg:order-none">
          <Field label="Status" required>
            <Select
              value={String(task.stateId)}
              disabled={!canEdit}
              onValueChange={(v) => save({ stateId: Number(v) })}
              options={board.states.map((s) => ({ value: String(s.id), label: s.name }))}
            />
          </Field>
          <Field label="Assignee">
            <Select
              value={task.assigneeId === null ? NONE : String(task.assigneeId)}
              disabled={!canEdit}
              onValueChange={(v) => save({ assigneeId: v === NONE ? null : Number(v) })}
              options={[
                { value: NONE, label: "Unassigned" },
                ...assignable.map((m) => ({ value: String(m.id), label: m.name })),
                // Someone no longer assignable still shows as the current assignee.
                ...(task.assigneeId !== null && !assignable.some((m) => m.id === task.assigneeId)
                  ? [{ value: String(task.assigneeId), label: people.get(task.assigneeId)?.name ?? "Former member", disabled: true }]
                  : []),
              ]}
            />
          </Field>
          <DueField task={task} today={today} done={done} canEdit={canEdit} onSave={(dueDate) => save({ dueDate })} />
          <Field label="Priority" required>
            <Select
              value={task.priority}
              disabled={!canEdit}
              onValueChange={(v) => save({ priority: v as never })}
              options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
            />
          </Field>
          <LabelsField task={task} board={board} canEdit={canEdit} onSave={(labelIds) => save({ labelIds })} />
          <Field label="Scope" required>
            <Select value={task.scope} disabled={!canEdit} onValueChange={(v) => save({ scope: v as never })} options={SCOPES.map((s) => ({ value: s, label: SCOPE_LABELS[s] }))} />
          </Field>
          <Field label="Type" required>
            <Select value={task.type} disabled={!canEdit} onValueChange={(v) => save({ type: v as never })} options={TASK_TYPES.map((t) => ({ value: t, label: TASK_TYPE_LABELS[t] }))} />
          </Field>
          {task.type !== "epic" && (
            <Field label="Epic">
              <Select
                value={task.epicId === null ? NONE : String(task.epicId)}
                disabled={!canEdit}
                onValueChange={(v) => save({ epicId: v === NONE ? null : Number(v) })}
                options={[
                  { value: NONE, label: "None" },
                  ...board.tasks.filter((t) => t.type === "epic").map((t) => ({ value: String(t.id), label: `${t.key} ${t.title}` })),
                ]}
              />
            </Field>
          )}
          {board.milestones.length > 0 && (
            <Field label="Milestone">
              <Select
                value={task.milestoneId === null ? NONE : String(task.milestoneId)}
                disabled={!canEdit}
                onValueChange={(v) => save({ milestoneId: v === NONE ? null : Number(v) })}
                options={[{ value: NONE, label: "None" }, ...board.milestones.map((m) => ({ value: String(m.id), label: m.name }))]}
              />
            </Field>
          )}
          {board.components.length > 0 && (
            <Field label="Component">
              <Select
                value={task.componentId === null ? NONE : String(task.componentId)}
                disabled={!canEdit}
                onValueChange={(v) => save({ componentId: v === NONE ? null : Number(v) })}
                options={[{ value: NONE, label: "None" }, ...board.components.map((c) => ({ value: String(c.id), label: c.name }))]}
              />
            </Field>
          )}
          <WatchButton task={task} me={me} />
          {canDelete && <DeleteTask task={task} csrfToken={me.csrfToken} onDeleted={onDeleted} />}
        </aside>
      </div>
    </div>
  );
}

function TitleField({ task, canEdit, onSave }: { task: TaskDetail; canEdit: boolean; onSave: (title: string) => void }) {
  const [value, setValue] = useState(task.title);
  const [error, setError] = useState<string>();
  useEffect(() => setValue(task.title), [task.title]);
  if (!canEdit) return <h2 className="text-title text-ink">{task.title}</h2>;
  const commit = () => {
    const next = value.trim();
    if (!next) {
      setError("Enter a title.");
      return;
    }
    setError(undefined);
    if (next !== task.title) onSave(next);
  };
  return (
    <Field label="Title" required error={error} className="[&>label]:sr-only">
      <Textarea
        rows={1}
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
          if (e.key === "Escape" && value !== task.title) {
            e.stopPropagation();
            setValue(task.title);
          }
        }}
        className="resize-none border-transparent px-2 text-title state-hover:border-line-strong"
      />
    </Field>
  );
}

function DueField({ task, today, done, canEdit, onSave }: { task: TaskDetail; today: string; done: boolean; canEdit: boolean; onSave: (d: string | null) => void }) {
  const [value, setValue] = useState(task.dueDate ?? "");
  useEffect(() => setValue(task.dueDate ?? ""), [task.dueDate]);
  return (
    <div className="flex flex-col gap-2">
      <Field label="Due date">
        <DateInput
          value={value}
          disabled={!canEdit}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => (value || null) !== task.dueDate && onSave(value || null)}
        />
      </Field>
      <DueBadge dueDate={task.dueDate} today={today} done={done} />
    </div>
  );
}

function LabelsField({ task, board, canEdit, onSave }: { task: TaskDetail; board: BoardResponse; canEdit: boolean; onSave: (ids: number[]) => void }) {
  const labels = board.labels.filter((l) => task.labelIds.includes(l.id));
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={id} className="text-secondary font-medium text-ink">
        Labels
      </span>
      <div className="flex flex-wrap items-center gap-1" aria-labelledby={id}>
        {labels.length === 0 && <span className="text-secondary text-ink-2">None</span>}
        {labels.map((l) => (
          <LabelChip key={l.id} label={l} />
        ))}
      </div>
      {canEdit && board.labels.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" icon={Tag}>
              Edit labels
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" aria-label="Labels" className="w-64 p-2">
            <div className="flex max-h-72 flex-col overflow-y-auto px-2">
              {board.labels.map((l) => (
                <Checkbox
                  key={l.id}
                  label={l.name}
                  checked={task.labelIds.includes(l.id)}
                  onCheckedChange={(on) => onSave(on ? [...task.labelIds, l.id] : task.labelIds.filter((x) => x !== l.id))}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body font-semibold text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// The editor loads only when someone starts writing, so the board stays light (NFR-11).
const RichTextEditor = lazy(() => import("./RichTextEditor"));

function Editor(props: ComponentProps<typeof RichTextEditor>) {
  return (
    <Suspense fallback={<Skeleton className="h-36 w-full rounded-control" />}>
      <RichTextEditor {...props} />
    </Suspense>
  );
}

function DescriptionSection({ task, people, canEdit, onSave }: { task: TaskDetail; people: Person[]; canEdit: boolean; onSave: (doc: RichTextDoc) => void }) {
  const [editing, setEditing] = useState(false);
  const draft = useRef<RichTextDoc>(task.description);
  const empty = isEmptyDoc(task.description);
  const start = () => {
    draft.current = task.description;
    setEditing(true);
  };
  return (
    <Section title="Description">
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft.current);
            setEditing(false);
          }}
        >
          <Editor
            kind="description"
            label="Description"
            initial={task.description}
            people={people}
            autoFocus
            onChange={(doc) => {
              draft.current = doc;
            }}
          />
          <p className="text-caption text-ink-2">{TASK_COPY.dataSafety}</p>
          <div className="flex gap-2">
            <Button type="submit">Save description</Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : empty ? (
        canEdit ? (
          <button
            type="button"
            onClick={start}
            className="min-h-touch rounded-control border border-dashed border-line-strong px-3 text-left text-secondary text-ink-2 state-hover:bg-hover"
          >
            {TASK_COPY.emptyDescription}
          </button>
        ) : (
          <p className="text-secondary text-ink-2">No description.</p>
        )
      ) : (
        <div className="flex flex-col gap-2">
          <RichTextView doc={task.description} />
          {canEdit && (
            <Button variant="ghost" className="self-start" onClick={start}>
              Edit description
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}

function SubtaskSection({ task, canEdit, csrfToken }: { task: TaskDetail; canEdit: boolean; csrfToken: string }) {
  const subtasks = useSubtasks(task, csrfToken);
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState<{ id: number; title: string } | null>(null);
  const doneCount = task.subtasks.filter((s) => s.done).length;

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Enter the checklist item.");
      return;
    }
    setAdding(true);
    try {
      await subtasks.add(title.trim());
      setTitle("");
      setError(undefined);
    } catch {
      setError(TASK_COPY.saveFailed);
    } finally {
      setAdding(false);
    }
  }

  return (
    <Section title="Checklist" action={task.subtasks.length > 0 && <span className="text-secondary text-ink-2 tabular-nums">{doneCount} of {task.subtasks.length} done</span>}>
      {task.subtasks.length > 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
          <div className="h-full rounded-full bg-accent transition-[width] duration-(--duration-menu) ease-out" style={{ width: `${(doneCount / task.subtasks.length) * 100}%` }} />
        </div>
      )}
      <ul className="flex flex-col">
        {task.subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <div className={cn("flex-1", s.done && "[&_label]:text-ink-2 [&_label]:line-through")}>
              <Checkbox
                label={s.title}
                checked={s.done}
                disabled={!canEdit}
                onCheckedChange={(done) => subtasks.update(s.id, { done }).catch(() => toast({ variant: "error", title: TASK_COPY.saveFailed }))}
              />
            </div>
            {canEdit && <IconButton icon={Trash2} label={`Delete “${s.title}”`} onClick={() => setDeleting(s)} />}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form onSubmit={add} className="flex items-start gap-2" noValidate>
          <Field label="New checklist item" className="flex-1 [&>label]:sr-only" error={error}>
            <TextInput value={title} placeholder="Add an item" maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" icon={Plus} loading={adding}>
            Add
          </Button>
        </form>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete “${deleting?.title ?? ""}”?`}
        description="This removes the item from the checklist for everyone."
        confirmLabel="Delete item"
        confirmIcon={Trash2}
        confirmAction={TASK_CONFIRM.deleteSubtask}
        successMessage="Checklist item deleted."
        onConfirm={(headers) => subtasks.remove(deleting!.id, headers)}
      />
    </Section>
  );
}

function formatTime(at: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone }).format(at);
  } catch {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(at);
  }
}

function CommentSection({
  task,
  me,
  people,
  mentionable,
  canComment,
  isAdmin,
}: {
  task: TaskDetail;
  me: MeResponse;
  people: Map<number, { name: string; avatarUrl: string | null }>;
  mentionable: Person[];
  canComment: boolean;
  isAdmin: boolean;
}) {
  const comments = useComments(task, me.csrfToken);
  const draft = useRef<{ doc: RichTextDoc; empty: boolean }>({ doc: { type: "doc", content: [] }, empty: true });
  // Remounting the composer clears it after posting.
  const [composerKey, setComposerKey] = useState(0);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<number | null>(null);
  const editDraft = useRef<RichTextDoc>({ type: "doc", content: [] });
  const [deleting, setDeleting] = useState<Comment | null>(null);

  async function post(e?: FormEvent) {
    e?.preventDefault();
    if (draft.current.empty) {
      setError("Write a comment first.");
      return;
    }
    setPosting(true);
    try {
      await comments.add(draft.current.doc);
      draft.current = { doc: { type: "doc", content: [] }, empty: true };
      setComposerKey((k) => k + 1);
      setError(undefined);
    } catch {
      setError(TASK_COPY.saveFailed);
    } finally {
      setPosting(false);
    }
  }

  return (
    <Section title="Comments">
      {task.comments.length === 0 && <p className="text-secondary text-ink-2">No comments yet.</p>}
      <ol className="flex flex-col gap-4">
        {task.comments.map((c) => {
          const author = people.get(c.authorId);
          const mine = c.authorId === me.user.id;
          return (
            <li key={c.id} className="flex gap-3">
              <Avatar name={author?.name ?? "?"} url={author?.avatarUrl ?? null} size="sm" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-caption text-ink-2">
                  <span className="font-medium text-ink">{author?.name ?? "Former member"}</span> · {formatTime(c.createdAt, me.user.timezone)}
                  {c.editedAt && " · edited"}
                </p>
                {editing === c.id ? (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await comments.edit(c.id, editDraft.current);
                        setEditing(null);
                      } catch {
                        toast({ variant: "error", title: TASK_COPY.saveFailed });
                      }
                    }}
                  >
                    <Editor
                      kind="comment"
                      label="Edit comment"
                      initial={c.body}
                      people={mentionable}
                      autoFocus
                      onChange={(doc) => {
                        editDraft.current = doc;
                      }}
                    />
                    <div className="flex gap-2">
                      <Button type="submit">Save comment</Button>
                      <Button variant="secondary" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : (
                  <RichTextView doc={c.body} className="flex flex-col gap-1 text-secondary text-ink break-words" />
                )}
                {canComment && editing !== c.id && (mine || isAdmin) && (
                  <div className="flex gap-1">
                    {mine && (
                      <Button
                        variant="ghost"
                        className="min-h-touch px-2 text-caption"
                        onClick={() => {
                          editDraft.current = c.body;
                          setEditing(c.id);
                        }}
                      >
                        Edit
                      </Button>
                    )}
                    <Button variant="ghost" className="min-h-touch px-2 text-caption text-danger-ink" onClick={() => setDeleting(c)}>
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {canComment && (
        <form onSubmit={post} className="flex flex-col gap-2" noValidate>
          <Editor
            key={composerKey}
            kind="comment"
            label="Add a comment"
            initial={null}
            people={mentionable}
            onSubmit={() => void post()}
            onChange={(doc, empty) => {
              draft.current = { doc, empty };
              if (!empty) setError(undefined);
            }}
          />
          {error && (
            <p role="alert" className="text-caption text-danger-ink">
              {error}
            </p>
          )}
          <p className="text-caption text-ink-2">{TASK_COPY.dataSafety}</p>
          <Button type="submit" loading={posting} className="self-start">
            Comment
          </Button>
        </form>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this comment?"
        description="This removes the comment for everyone."
        confirmLabel="Delete comment"
        confirmIcon={Trash2}
        confirmAction={TASK_CONFIRM.deleteComment}
        successMessage="Comment deleted."
        onConfirm={(headers) => comments.remove(deleting!.id, headers)}
      />
    </Section>
  );
}

function describeEvent(e: TaskEvent, board: BoardResponse, people: Map<number, { name: string }>): string {
  const state = (v: string | null) => board.states.find((s) => String(s.id) === v)?.name ?? "another column";
  const person = (v: string | null) => (v ? (people.get(Number(v))?.name ?? "someone") : "nobody");
  const label = (v: string | null) => (v ? v.split(",").map((id) => board.labels.find((l) => String(l.id) === id)?.name ?? "a removed label").join(", ") : "none");
  switch (e.field) {
    case "created":
      return "created this task";
    case "state":
      return `moved it from ${state(e.oldValue)} to ${state(e.newValue)}`;
    case "assignee":
      return e.newValue ? `assigned it to ${person(e.newValue)}` : "unassigned it";
    case "title":
      return `renamed it to “${e.newValue}”`;
    case "description":
      return "edited the description";
    case "priority":
      return `changed priority from ${PRIORITY_LABELS[e.oldValue as never] ?? e.oldValue} to ${PRIORITY_LABELS[e.newValue as never] ?? e.newValue}`;
    case "scope":
      return `marked it ${SCOPE_LABELS[e.newValue as never] ?? e.newValue}`;
    case "type":
      return `changed the type to ${TASK_TYPE_LABELS[e.newValue as never] ?? e.newValue}`;
    case "due_date":
      return e.newValue ? `set the due date to ${formatDate(e.newValue, true)}` : "removed the due date";
    case "labels":
      return `changed labels to ${label(e.newValue)}`;
    case "epic":
      return e.newValue ? "changed the epic" : "removed it from its epic";
    case "milestone":
      return e.newValue ? "changed the milestone" : "removed the milestone";
    case "component":
      return e.newValue ? "changed the component" : "removed the component";
    case "subtask_added":
      return `added “${e.newValue}” to the checklist`;
    case "subtask_done":
      return `ticked “${e.newValue}”`;
    case "subtask_undone":
      return `unticked “${e.newValue}”`;
    case "subtask_removed":
      return `removed “${e.oldValue}” from the checklist`;
    case "attachment_added":
      return `attached ${e.newValue}`;
    case "attachment_removed":
      return `deleted the file ${e.oldValue}`;
    default:
      return "changed the task";
  }
}

function ActivitySection({ task, board, people, timezone }: { task: TaskDetail; board: BoardResponse; people: Map<number, { name: string }>; timezone: string }) {
  return (
    <Section title="Activity">
      <ol className="flex flex-col gap-2 border-l border-line pl-4">
        {[...task.events].reverse().map((e) => (
          <li key={e.id} className="text-caption text-ink-2">
            <span className="font-medium text-ink">{e.actorId ? (people.get(e.actorId)?.name ?? "Former member") : "The hub"}</span> {describeEvent(e, board, people)}
            <span className="block tabular-nums">{formatTime(e.at, timezone)}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function WatchButton({ task, me }: { task: TaskDetail; me: MeResponse }) {
  const watch = useWatch(task, me.user.id, me.csrfToken);
  const watching = task.watcherIds.includes(me.user.id);
  return (
    <Button
      variant="secondary"
      icon={watching ? BellOff : Bell}
      aria-pressed={watching}
      loading={watch.isPending}
      onClick={() => watch.mutate(!watching, { onError: () => toast({ variant: "error", title: TASK_COPY.saveFailed }) })}
    >
      {watching ? "Stop watching" : "Watch"}
    </Button>
  );
}

function DeleteTask({ task, csrfToken, onDeleted }: { task: TaskDetail; csrfToken: string; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const remove = useDeleteTask(task, csrfToken);
  return (
    <>
      <Button variant="destructive" icon={Trash2} onClick={() => setOpen(true)}>
        Delete task
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${task.key}?`}
        description="This removes the task and its comments for everyone."
        confirmLabel="Delete task"
        confirmIcon={Trash2}
        confirmAction={TASK_CONFIRM.deleteTask}
        successMessage={TASK_COPY.deleted}
        onConfirm={async (headers) => {
          await remove(headers);
          onDeleted();
        }}
      />
    </>
  );
}
