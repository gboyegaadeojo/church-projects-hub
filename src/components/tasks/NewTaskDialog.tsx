import { type FormEvent, useState } from "react";
import {
  createTaskBody,
  type Member,
  PRIORITIES,
  PRIORITY_LABELS,
  TASK_COPY,
  TASK_TYPE_LABELS,
  TASK_TYPES,
  type TaskDetail,
  type WorkflowState,
} from "../../../shared/tasks";
import { ApiError } from "../../lib/api";
import { useCreateTask } from "../../lib/tasks";
import { Button } from "../ui/Button";
import { Select } from "../ui/choices";
import { Dialog, DialogContent } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { DateInput, TextInput } from "../ui/inputs";
import { toast } from "../ui/Toast";

// Quick create (TASK-1): title plus the fields people usually set first. Everything else is edited inline
// on the task itself (section 11.3).

const NONE = "none";

export function NewTaskDialog({
  open,
  onOpenChange,
  projectId,
  csrfToken,
  states,
  assignable,
  defaultStateId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  csrfToken: string;
  states: WorkflowState[];
  assignable: Member[];
  defaultStateId?: number;
  onCreated: (task: TaskDetail) => void;
}) {
  const create = useCreateTask(projectId, csrfToken);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>("task");
  const [priority, setPriority] = useState<string>("medium");
  const [stateId, setStateId] = useState<string>("");
  const [assignee, setAssignee] = useState<string>(NONE);
  const [secondary, setSecondary] = useState<string>(NONE);
  const [due, setDue] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);

  function reset() {
    setTitle("");
    setType("task");
    setPriority("medium");
    setStateId(String(defaultStateId ?? states[0]?.id ?? ""));
    setAssignee(NONE);
    setSecondary(NONE);
    setDue("");
    setErrors({});
    setFailed(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = {
      title,
      type,
      priority,
      stateId: stateId ? Number(stateId) : undefined,
      assigneeId: assignee === NONE ? null : Number(assignee),
      // Never the same person twice (v4.6).
      secondaryAssigneeId: secondary === NONE || secondary === assignee ? null : Number(secondary),
      dueDate: due || null,
    };
    const parsed = createTaskBody.safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setFailed(false);
    try {
      const task = await create.mutateAsync(body as Parameters<typeof create.mutateAsync>[0]);
      onOpenChange(false);
      toast({ variant: "success", title: `${task.key} created.` });
      onCreated(task);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const field = (err.body as { field?: string } | null)?.field;
        if (field === "assigneeId") setErrors({ assigneeId: "That person can't be assigned here. Choose someone else." });
        else if (field === "secondaryAssigneeId") setErrors({ secondaryAssigneeId: "That person can't be assigned here. Choose someone else." });
        else setFailed(true);
      } else setFailed(true);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        title="New task"
        onOpenAutoFocus={() => reset()}
        footer={
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="new-task" loading={create.isPending}>
              Create task
            </Button>
          </>
        }
      >
        <form id="new-task" onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field label="Title" required error={errors.title}>
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoComplete="off" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" required>
              <Select value={type} onValueChange={setType} options={TASK_TYPES.map((t) => ({ value: t, label: TASK_TYPE_LABELS[t] }))} />
            </Field>
            <Field label="Priority" required>
              <Select
                value={priority}
                onValueChange={setPriority}
                options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
              />
            </Field>
            <Field label="Column" required>
              <Select value={stateId} onValueChange={setStateId} options={states.map((s) => ({ value: String(s.id), label: s.name }))} />
            </Field>
            <Field label="Assignee" error={errors.assigneeId}>
              <Select
                value={assignee}
                onValueChange={setAssignee}
                options={[{ value: NONE, label: "Unassigned" }, ...assignable.map((m) => ({ value: String(m.id), label: m.name }))]}
              />
            </Field>
            <Field label="Secondary assignee" error={errors.secondaryAssigneeId}>
              <Select
                value={secondary === assignee ? NONE : secondary}
                onValueChange={setSecondary}
                options={[
                  { value: NONE, label: "None" },
                  ...assignable.filter((m) => String(m.id) !== assignee).map((m) => ({ value: String(m.id), label: m.name })),
                ]}
              />
            </Field>
            <Field label="Due date" error={errors.dueDate}>
              <DateInput value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          </div>
          <p className="text-caption text-ink-2">{TASK_COPY.dataSafety}</p>
          {failed && (
            <p role="alert" className="rounded-control bg-danger-soft p-3 text-secondary text-danger-ink">
              {TASK_COPY.saveFailed}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
