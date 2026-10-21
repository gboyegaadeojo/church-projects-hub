import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { ADMIN_CONFIRM } from "../../shared/admin";
import { Icon } from "../components/ui/Icon";
import { type FormEvent, type ReactNode, useState } from "react";
import { useParams } from "react-router";
import { PROJECT_COLOURS, PROJECT_DESCRIPTION_MAX, PROJECT_ICONS, PROJECT_NAME_MAX, type ProjectColour, type ProjectIcon, projectResponse, type ProjectSummary } from "../../shared/projects";
import {
  type BoardResponse,
  type Component,
  type Label,
  type Milestone,
  TASK_CONFIRM,
  TASK_ERRORS,
  TASK_LIMITS,
  WORKFLOW_CATEGORY_VALUES,
  type WorkflowCategory,
  type WorkflowState,
} from "../../shared/tasks";
import { ProjectTile, useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { ProjectTabs } from "../components/shell/ProjectTabs";
import { formatDate, LabelChip } from "../components/tasks/bits";
import { columnTones, StatusPill } from "../components/tasks/tones";
import { Button, IconButton } from "../components/ui/Button";
import { Select, Switch } from "../components/ui/choices";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Field } from "../components/ui/Field";
import { DateInput, TextInput } from "../components/ui/inputs";
import { Skeleton } from "../components/ui/Skeleton";
import { ErrorState } from "../components/ui/States";
import { toast } from "../components/ui/Toast";
import { api, ApiError } from "../lib/api";
import { PROJECT_COLOUR_CLASSES, PROJECT_ICON_COMPONENTS, PROJECT_ICON_LABELS } from "../lib/projects";
import { boardKey, useBoard } from "../lib/tasks";
import { ChoiceGrid } from "./AdminProjectsPage";

// Project settings (PROJ-3, ORG-1, ORG-2, ORG-4): a project's workflow columns, labels, components and milestones,
// all per project. Project Admins and App Admins change them ("Edit workflow, labels, components", section 2); everyone
// else in the project sees them read-only. The API checks every change (NFR-1).

const SAVE_FAILED = "We couldn't save this change. Check your connection and try again.";
const CATEGORY_LABELS: Record<WorkflowCategory, string> = { todo: "To do", in_progress: "In progress", done: "Done" };

export function ProjectSettingsPage() {
  const { key = "" } = useParams();
  const project = useQuery({
    queryKey: ["projects", "by-key", key.toUpperCase()],
    queryFn: async () => projectResponse.parse(await api(`/api/projects/by-key/${encodeURIComponent(key)}`)).project,
  });
  if (project.isPending) {
    return (
      <PageLayout title="Project settings">
        <Skeleton className="h-48 w-full rounded-card" />
      </PageLayout>
    );
  }
  if (project.isError) {
    return (
      <PageLayout title="Project settings">
        <ErrorState title="We couldn't load this project." description="Check your connection and try again." onRetry={() => void project.refetch()} retrying={project.isFetching} />
      </PageLayout>
    );
  }
  return <Settings project={project.data} />;
}

function Settings({ project }: { project: ProjectSummary }) {
  const me = useMe();
  const board = useBoard(project.id);
  // v4.7: the project's admins run it fully: details, archive and restore as well as its organisation.
  const isProjectAdmin = (me.user.appRole === "admin" || project.role === "admin") && !project.isSystem;
  const canManage = !project.archived && (me.user.appRole === "admin" || project.role === "admin");
  const data = board.data;
  return (
    <PageLayout
      wide
      title={project.name}
      breadcrumbs={[{ to: "/projects", label: "Projects" }]}
      leading={<ProjectTile project={project} size="lg" />}
      intro={canManage ? "Columns, labels, components and milestones for this project." : undefined}
    >
      <ProjectTabs projectKey={project.key} active="settings" />
      {!canManage && (
        <p className="flex items-center gap-2 rounded-control border border-line bg-card px-3 py-2 text-secondary text-ink-2">
          <Lock className="size-icon-sm" aria-hidden="true" />
          Only this project's admins can change these.
        </p>
      )}
      {board.isPending ? (
        <Skeleton className="h-64 w-full rounded-card" />
      ) : board.isError || !data ? (
        <ErrorState title="We couldn't load the settings." description="Check your connection and try again." onRetry={() => void board.refetch()} retrying={board.isFetching} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {isProjectAdmin && <DetailsSection project={project} />}
          {isProjectAdmin && <ArchiveSection project={project} />}
          <ColumnsSection project={project} data={data} canManage={canManage} />
          <LabelsSection project={project} data={data} canManage={canManage} />
          <ComponentsSection project={project} data={data} canManage={canManage} />
          <MilestonesSection project={project} data={data} canManage={canManage} />
        </div>
      )}
    </PageLayout>
  );
}

/* ---------- Shared pieces ---------- */

function Card({ title, description, children, action }: { title: string; description: string; children: ReactNode; action?: ReactNode }) {
  const id = `settings-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-card border border-line bg-card p-5 shadow-raised">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={id} className="text-body font-semibold text-ink">
            {title}
          </h2>
          <p className="text-secondary text-ink-2">{description}</p>
        </div>
        {action && <div className="shrink-0 [&_button]:whitespace-nowrap">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Calls the API and refreshes the board data everything else reads. Returns false (and says why) on failure. */
function useSave(projectId: number) {
  const me = useMe();
  const queryClient = useQueryClient();
  return async (path: string, method: string, body?: unknown, headers?: Record<string, string>, nameTaken = "That name is already used in this project.") => {
    try {
      await api(path, { method, body, csrfToken: me.csrfToken, headers });
      await queryClient.invalidateQueries({ queryKey: boardKey(projectId) });
      return true;
    } catch (err) {
      const error = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
      toast({
        variant: "error",
        title:
          error === TASK_ERRORS.nameTaken
            ? nameTaken
            : error === TASK_ERRORS.tooMany
              ? `A project can have at most ${TASK_LIMITS.columns} columns.`
              : SAVE_FAILED,
      });
      return false;
    }
  };
}

function ColourPicker({ value, onChange }: { value: ProjectColour; onChange: (c: ProjectColour) => void }) {
  return (
    <ChoiceGrid
      legend="Colour"
      value={value}
      onChange={(v) => onChange(v as ProjectColour)}
      options={PROJECT_COLOURS.map((c) => ({
        value: c,
        label: PROJECT_COLOUR_CLASSES[c].label,
        content: <span aria-hidden="true" className={`size-4 rounded-full ${PROJECT_COLOUR_CLASSES[c].bg}`} />,
      }))}
    />
  );
}

function RowActions({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete?: () => void }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      <IconButton icon={Pencil} label={`Edit ${label}`} onClick={onEdit} />
      {onDelete && <IconButton icon={Trash2} label={`Delete ${label}`} className="text-danger-ink" onClick={onDelete} />}
    </span>
  );
}

function FormButtons({ onCancel, saving, submitLabel }: { onCancel: () => void; saving: boolean; submitLabel: string }) {
  return (
    <div className="flex gap-2">
      <Button type="submit" icon={Check} loading={saving}>
        {submitLabel}
      </Button>
      <Button variant="ghost" icon={X} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/* ---------- Project details and archive (v4.7: Project Admins) ---------- */

function DetailsSection({ project }: { project: ProjectSummary }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [colour, setColour] = useState<ProjectColour>(project.colour);
  const [icon, setIcon] = useState<ProjectIcon>(project.icon);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const dirty = name !== project.name || description !== project.description || colour !== project.colour || icon !== project.icon;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Enter a project name.");
    setError(undefined);
    setSaving(true);
    try {
      await api(`/api/projects/${project.id}`, { method: "PATCH", body: { name: name.trim(), description: description.trim(), colour, icon }, csrfToken: me.csrfToken });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast({ variant: "success", title: "Project updated." });
    } catch {
      toast({ variant: "error", title: SAVE_FAILED });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card title="Project details" description="The name, description, colour and icon everyone in the project sees.">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Project name" required error={error}>
          <TextInput value={name} maxLength={PROJECT_NAME_MAX} onChange={(e) => setName(e.target.value)} disabled={project.archived} />
        </Field>
        <Field label="Description">
          <TextInput value={description} maxLength={PROJECT_DESCRIPTION_MAX} onChange={(e) => setDescription(e.target.value)} disabled={project.archived} />
        </Field>
        <ColourPicker value={colour} onChange={setColour} />
        <ChoiceGrid
          legend="Icon"
          value={icon}
          onChange={(v) => setIcon(v as ProjectIcon)}
          options={PROJECT_ICONS.map((i) => ({ value: i, label: PROJECT_ICON_LABELS[i], content: <Icon icon={PROJECT_ICON_COMPONENTS[i]} /> }))}
        />
        {!project.archived && (
          <Button type="submit" icon={Check} loading={saving} disabled={!dirty} className="self-start">
            Save details
          </Button>
        )}
      </form>
    </Card>
  );
}

function ArchiveSection({ project }: { project: ProjectSummary }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["projects"] });
  return (
    <Card
      title={project.archived ? "Archived" : "Archive this project"}
      description={
        project.archived
          ? "This project is read-only. Restore it to let people work in it again."
          : "Archiving makes the project read-only for everyone. Nothing is deleted, and you can restore it."
      }
    >
      {project.archived ? (
        <Button
          variant="secondary"
          icon={ArchiveRestore}
          className="self-start"
          onClick={async () => {
            try {
              await api(`/api/projects/${project.id}/restore`, { method: "POST", csrfToken: me.csrfToken });
              await refresh();
              toast({ variant: "success", title: "Project restored." });
            } catch {
              toast({ variant: "error", title: SAVE_FAILED });
            }
          }}
        >
          Restore project
        </Button>
      ) : (
        <Button variant="destructive" icon={Archive} className="self-start" onClick={() => setOpen(true)}>
          Archive project
        </Button>
      )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Archive ${project.name}?`}
        description="Everyone in the project will be able to read it but not change anything until it's restored."
        confirmLabel="Archive project"
        confirmIcon={Archive}
        confirmAction={ADMIN_CONFIRM.archiveProject}
        confirmText={project.key}
        successMessage="Project archived."
        onConfirm={async (headers) => {
          await api(`/api/projects/${project.id}/archive`, { method: "POST", csrfToken: me.csrfToken, headers });
          await refresh();
        }}
      />
    </Card>
  );
}

/* ---------- Workflow columns (PROJ-3) ---------- */

function ColumnsSection({ project, data, canManage }: { project: ProjectSummary; data: BoardResponse; canManage: boolean }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const save = useSave(project.id);
  const tones = columnTones(data.states);
  const counts = new Map<number, number>();
  for (const t of data.tasks) counts.set(t.stateId, (counts.get(t.stateId) ?? 0) + 1);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [removing, setRemoving] = useState<WorkflowState | null>(null);
  const states = [...data.states].sort((a, b) => a.position - b.position);

  const move = (index: number, by: -1 | 1) => {
    const ids = states.map((s) => s.id);
    [ids[index], ids[index + by]] = [ids[index + by]!, ids[index]!];
    void save(`/api/projects/${project.id}/states/order`, "PUT", { ids });
  };

  return (
    <Card
      title="Workflow columns"
      description={`The board's columns, in order from left to right. Up to ${TASK_LIMITS.columns}. Reports group them by what they mean.`}
      action={
        canManage &&
        states.length < TASK_LIMITS.columns &&
        editing !== "new" && (
          <Button variant="secondary" icon={Plus} onClick={() => setEditing("new")}>
            Add column
          </Button>
        )
      }
    >
      <ol className="flex flex-col divide-y divide-line">
        {states.map((s, i) =>
          editing === s.id ? (
            <li key={s.id} className="py-3">
              <ColumnForm
                initial={s}
                onCancel={() => setEditing(null)}
                onSubmit={async (body) => (await save(`/api/states/${s.id}`, "PATCH", body, undefined, "That column name is already used.")) && setEditing(null)}
              />
            </li>
          ) : (
            <li key={s.id} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <StatusPill name={s.name} tone={tones.get(s.id) ?? "grey"} className="min-w-28" />
              <span className="text-secondary text-ink-2">{CATEGORY_LABELS[s.category]}</span>
              <span className="text-caption text-ink-2 tabular-nums">
                {counts.get(s.id) ?? 0} {counts.get(s.id) === 1 ? "task" : "tasks"}
              </span>
              {canManage && (
                <span className="ml-auto flex items-center gap-1">
                  <IconButton icon={ArrowUp} label={`Move ${s.name} earlier`} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton icon={ArrowDown} label={`Move ${s.name} later`} disabled={i === states.length - 1} onClick={() => move(i, 1)} />
                  <RowActions label={s.name} onEdit={() => setEditing(s.id)} onDelete={states.length > 1 ? () => setRemoving(s) : undefined} />
                </span>
              )}
            </li>
          ),
        )}
      </ol>
      {editing === "new" && (
        <ColumnForm
          onCancel={() => setEditing(null)}
          onSubmit={async (body) => (await save(`/api/projects/${project.id}/states`, "POST", body, undefined, "That column name is already used.")) && setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove the ${removing?.name ?? ""} column?`}
        description="Only a column no task has ever been in can be removed, so reports keep their history. Move tasks out and rename it instead if it has been used."
        confirmLabel="Remove column"
        confirmIcon={Trash2}
        confirmAction={TASK_CONFIRM.deleteState}
        onConfirm={async (headers) => {
          try {
            await api(`/api/states/${removing!.id}`, { method: "DELETE", csrfToken: me.csrfToken, headers });
            toast({ variant: "success", title: "Column removed." });
          } catch (err) {
            // A column tasks have been in stays, so reports keep their history: say so instead of a generic failure.
            if (!(err instanceof ApiError && err.status === 409)) throw err;
            setRemoving(null);
            toast({ variant: "error", title: "Tasks have been in this column, so it stays. Rename it instead." });
          }
          await queryClient.invalidateQueries({ queryKey: boardKey(project.id) });
        }}
      />
    </Card>
  );
}

function ColumnForm({ initial, onSubmit, onCancel }: { initial?: WorkflowState; onSubmit: (body: { name: string; category: WorkflowCategory }) => Promise<unknown>; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<WorkflowCategory>(initial?.category ?? "todo");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Enter a column name.");
    setSaving(true);
    await onSubmit({ name: name.trim(), category });
    setSaving(false);
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-control border border-line bg-page p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Column name" required error={error}>
          <TextInput value={name} maxLength={TASK_LIMITS.stateName} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Means" required>
          <Select value={category} onValueChange={(v) => setCategory(v as WorkflowCategory)} options={WORKFLOW_CATEGORY_VALUES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
        </Field>
      </div>
      <FormButtons onCancel={onCancel} saving={saving} submitLabel={initial ? "Save column" : "Add column"} />
    </form>
  );
}

/* ---------- Labels (ORG-1) ---------- */

function LabelsSection({ project, data, canManage }: { project: ProjectSummary; data: BoardResponse; canManage: boolean }) {
  const save = useSave(project.id);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [deleting, setDeleting] = useState<Label | null>(null);
  const counts = new Map<number, number>();
  for (const t of data.tasks) for (const id of t.labelIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  return (
    <Card
      title="Labels"
      description="Tags for this project's tasks, each with a colour. Other projects have their own."
      action={
        canManage &&
        editing !== "new" && (
          <Button variant="secondary" icon={Plus} onClick={() => setEditing("new")}>
            New label
          </Button>
        )
      }
    >
      {data.labels.length === 0 && editing !== "new" && <p className="text-secondary text-ink-2">No labels yet.</p>}
      <ul className="flex flex-col divide-y divide-line">
        {data.labels.map((l) =>
          editing === l.id ? (
            <li key={l.id} className="py-3">
              <LabelForm
                initial={l}
                onCancel={() => setEditing(null)}
                onSubmit={async (body) => (await save(`/api/labels/${l.id}`, "PATCH", body)) && setEditing(null)}
              />
            </li>
          ) : (
            <li key={l.id} className="flex min-h-12 items-center gap-3 py-2">
              <LabelChip label={l} />
              <span className="text-caption text-ink-2 tabular-nums">
                {counts.get(l.id) ?? 0} {counts.get(l.id) === 1 ? "task" : "tasks"}
              </span>
              {canManage && <RowActions label={l.name} onEdit={() => setEditing(l.id)} onDelete={() => setDeleting(l)} />}
            </li>
          ),
        )}
      </ul>
      {editing === "new" && (
        <LabelForm onCancel={() => setEditing(null)} onSubmit={async (body) => (await save(`/api/projects/${project.id}/labels`, "POST", body)) && setEditing(null)} />
      )}
      <DeleteItem
        projectId={project.id}
        item={deleting}
        onClose={() => setDeleting(null)}
        path="labels"
        noun="label"
        confirmAction={TASK_CONFIRM.deleteLabel}
        consequence="This removes the label from every task in this project."
      />
    </Card>
  );
}

function LabelForm({ initial, onSubmit, onCancel }: { initial?: Label; onSubmit: (body: { name: string; colour: ProjectColour }) => Promise<unknown>; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [colour, setColour] = useState<ProjectColour>(initial?.colour ?? "blue");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Enter a label name.");
    setSaving(true);
    await onSubmit({ name: name.trim(), colour });
    setSaving(false);
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-control border border-line bg-page p-3">
      <Field label="Label name" required error={error}>
        <TextInput value={name} maxLength={TASK_LIMITS.labelName} autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>
      <ColourPicker value={colour} onChange={setColour} />
      <p className="flex items-center gap-2 text-caption text-ink-2">
        Preview: <LabelChip label={{ name: name.trim() || "Label", colour }} />
      </p>
      <FormButtons onCancel={onCancel} saving={saving} submitLabel={initial ? "Save label" : "Add label"} />
    </form>
  );
}

/* ---------- Components (ORG-2) ---------- */

const NONE = "none";

function ComponentsSection({ project, data, canManage }: { project: ProjectSummary; data: BoardResponse; canManage: boolean }) {
  const save = useSave(project.id);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [deleting, setDeleting] = useState<Component | null>(null);
  const leadName = (id: number | null) => (id === null ? null : (data.members.find((m) => m.id === id)?.name ?? "Former member"));
  return (
    <Card
      title="Components"
      description="Areas of the team's work, such as Audio, Lighting or Stage, each with an optional lead."
      action={
        canManage &&
        editing !== "new" && (
          <Button variant="secondary" icon={Plus} onClick={() => setEditing("new")}>
            New component
          </Button>
        )
      }
    >
      {data.components.length === 0 && editing !== "new" && <p className="text-secondary text-ink-2">No components yet.</p>}
      <ul className="flex flex-col divide-y divide-line">
        {data.components.map((c) =>
          editing === c.id ? (
            <li key={c.id} className="py-3">
              <ComponentForm initial={c} data={data} onCancel={() => setEditing(null)} onSubmit={async (body) => (await save(`/api/components/${c.id}`, "PATCH", body)) && setEditing(null)} />
            </li>
          ) : (
            <li key={c.id} className="flex min-h-12 items-center gap-3 py-2">
              <span className="text-secondary font-medium text-ink">{c.name}</span>
              <span className="text-caption text-ink-2">{leadName(c.leadId) ? `Lead: ${leadName(c.leadId)}` : "No lead"}</span>
              {canManage && <RowActions label={c.name} onEdit={() => setEditing(c.id)} onDelete={() => setDeleting(c)} />}
            </li>
          ),
        )}
      </ul>
      {editing === "new" && (
        <ComponentForm data={data} onCancel={() => setEditing(null)} onSubmit={async (body) => (await save(`/api/projects/${project.id}/components`, "POST", body)) && setEditing(null)} />
      )}
      <DeleteItem
        projectId={project.id}
        item={deleting}
        onClose={() => setDeleting(null)}
        path="components"
        noun="component"
        confirmAction={TASK_CONFIRM.deleteComponent}
        consequence="Tasks in this component keep everything else; their component is cleared."
      />
    </Card>
  );
}

function ComponentForm({
  initial,
  data,
  onSubmit,
  onCancel,
}: {
  initial?: Component;
  data: BoardResponse;
  onSubmit: (body: { name: string; leadId: number | null }) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [lead, setLead] = useState(initial?.leadId ? String(initial.leadId) : NONE);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Enter a component name.");
    setSaving(true);
    await onSubmit({ name: name.trim(), leadId: lead === NONE ? null : Number(lead) });
    setSaving(false);
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-control border border-line bg-page p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Component name" required error={error}>
          <TextInput value={name} maxLength={TASK_LIMITS.componentName} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Lead" filter>
          <Select value={lead} onValueChange={setLead} options={[{ value: NONE, label: "No lead" }, ...data.members.map((m) => ({ value: String(m.id), label: m.name }))]} />
        </Field>
      </div>
      <FormButtons onCancel={onCancel} saving={saving} submitLabel={initial ? "Save component" : "Add component"} />
    </form>
  );
}

/* ---------- Milestones (ORG-4) ---------- */

function MilestonesSection({ project, data, canManage }: { project: ProjectSummary; data: BoardResponse; canManage: boolean }) {
  const save = useSave(project.id);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [deleting, setDeleting] = useState<Milestone | null>(null);
  return (
    <Card
      title="Milestones"
      description="Events the team works towards, such as Easter or a camp, with a target date."
      action={
        canManage &&
        editing !== "new" && (
          <Button variant="secondary" icon={Plus} onClick={() => setEditing("new")}>
            New milestone
          </Button>
        )
      }
    >
      {data.milestones.length === 0 && editing !== "new" && <p className="text-secondary text-ink-2">No milestones yet.</p>}
      <ul className="flex flex-col divide-y divide-line">
        {data.milestones.map((m) =>
          editing === m.id ? (
            <li key={m.id} className="py-3">
              <MilestoneForm initial={m} onCancel={() => setEditing(null)} onSubmit={async (body) => (await save(`/api/milestones/${m.id}`, "PATCH", body)) && setEditing(null)} />
            </li>
          ) : (
            <li key={m.id} className="flex min-h-12 items-center gap-3 py-2">
              <span className="text-secondary font-medium text-ink">{m.name}</span>
              <span className="text-caption text-ink-2 tabular-nums">{m.targetDate ? formatDate(m.targetDate, true) : "No date"}</span>
              {m.released && <span className="rounded-chip bg-done-soft px-1.5 text-label text-done-ink">Done</span>}
              {canManage && <RowActions label={m.name} onEdit={() => setEditing(m.id)} onDelete={() => setDeleting(m)} />}
            </li>
          ),
        )}
      </ul>
      {editing === "new" && (
        <MilestoneForm onCancel={() => setEditing(null)} onSubmit={async (body) => (await save(`/api/projects/${project.id}/milestones`, "POST", body)) && setEditing(null)} />
      )}
      <DeleteItem
        projectId={project.id}
        item={deleting}
        onClose={() => setDeleting(null)}
        path="milestones"
        noun="milestone"
        confirmAction={TASK_CONFIRM.deleteMilestone}
        consequence="Tasks keep everything else; their milestone is cleared."
      />
    </Card>
  );
}

function MilestoneForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Milestone;
  onSubmit: (body: { name: string; targetDate: string | null; released: boolean }) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [date, setDate] = useState(initial?.targetDate ?? "");
  const [released, setReleased] = useState(initial?.released ?? false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Enter a milestone name.");
    setSaving(true);
    await onSubmit({ name: name.trim(), targetDate: date || null, released });
    setSaving(false);
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-control border border-line bg-page p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Milestone name" required error={error}>
          <TextInput value={name} maxLength={TASK_LIMITS.milestoneName} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Target date">
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      {initial && <Switch label="This milestone is done" checked={released} onCheckedChange={setReleased} />}
      <FormButtons onCancel={onCancel} saving={saving} submitLabel={initial ? "Save milestone" : "Add milestone"} />
    </form>
  );
}

/* ---------- Delete (section 11.14) ---------- */

function DeleteItem({
  projectId,
  item,
  onClose,
  path,
  noun,
  confirmAction,
  consequence,
}: {
  projectId: number;
  item: { id: number; name: string } | null;
  onClose: () => void;
  path: string;
  noun: string;
  confirmAction: string;
  consequence: string;
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  return (
    <ConfirmDialog
      open={item !== null}
      onOpenChange={(open) => !open && onClose()}
      title={`Delete “${item?.name ?? ""}”?`}
      description={consequence}
      confirmLabel={`Delete ${noun}`}
      confirmIcon={Trash2}
      confirmAction={confirmAction}
      successMessage={`${noun.charAt(0).toUpperCase()}${noun.slice(1)} deleted.`}
      onConfirm={async (headers) => {
        await api(`/api/${path}/${item!.id}`, { method: "DELETE", csrfToken: me.csrfToken, headers });
        await queryClient.invalidateQueries({ queryKey: boardKey(projectId) });
      }}
    />
  );
}
