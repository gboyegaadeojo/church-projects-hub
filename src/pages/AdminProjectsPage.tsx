import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, EyeOff, FolderPlus, Lock, Pencil, Plus, Settings2 } from "lucide-react";
import { RadioGroup as RadixRadioGroup } from "radix-ui";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import type { z } from "zod";
import { ADMIN_CONFIRM } from "../../shared/admin";
import type { MeResponse } from "../../shared/auth";
import {
  createProjectBody,
  PROJECT_COLOURS,
  PROJECT_COPY,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_ERRORS,
  PROJECT_ICONS,
  PROJECT_NAME_MAX,
  type ProjectColour,
  type ProjectIcon,
  projectResponse,
  type ProjectSummary,
  updateProjectBody,
} from "../../shared/projects";
import { ADMIN_CRUMBS, ProjectGlyph, useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Switch } from "../components/ui/choices";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Dialog, DialogContent } from "../components/ui/Dialog";
import { Field, FieldError } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { Textarea, TextInput } from "../components/ui/inputs";
import { EmptyState, ErrorState } from "../components/ui/States";
import { type Column, Table } from "../components/ui/Table";
import { toast } from "../components/ui/Toast";
import { api, ApiError } from "../lib/api";
import { cn } from "../lib/cn";
import { PROJECT_COLOUR_CLASSES, PROJECT_ICON_COMPONENTS, PROJECT_ICON_LABELS, PROJECTS_KEY, useMyProjects } from "../lib/projects";

// Manage projects (PROJ-1, PROJ-4, PROJ-6): App Admins create projects, edit them (including the
// Hidden, invite-only flag), and archive or restore them.

const FAILED = "That didn't go through. Check your connection and try again.";

export function AdminProjectsPage() {
  const me = useMe();
  return (
    <PageLayout
      breadcrumbs={ADMIN_CRUMBS}
      title="Manage projects"
      actions={me.user.appRole === "admin" && <CreateProjectButton me={me} />}
    >
      {me.user.appRole === "admin" ? (
        <ProjectTable me={me} />
      ) : (
        <EmptyState icon={Settings2} title="Only app admins can create and manage projects." />
      )}
    </PageLayout>
  );
}

function ProjectTable({ me }: { me: MeResponse }) {
  // App Admins' own list holds every project (GET /api/projects).
  const projects = useMyProjects();
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [archiving, setArchiving] = useState<ProjectSummary | null>(null);
  const queryClient = useQueryClient();

  // PROJ-4: archive is high impact (type the key); restoring isn't destructive, so it needs no dialog.
  async function restore(p: ProjectSummary) {
    try {
      await api(`/api/projects/${p.id}/restore`, { method: "POST", csrfToken: me.csrfToken });
      await queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
      toast({ variant: "success", title: "Project restored." });
    } catch {
      toast({ variant: "error", title: FAILED });
    }
  }

  if (projects.isError) {
    return (
      <ErrorState
        title="We couldn't load projects."
        description="Check your connection and try again."
        onRetry={() => void projects.refetch()}
        retrying={projects.isFetching}
      />
    );
  }

  const columns: Column<ProjectSummary>[] = [
    {
      key: "project",
      header: "Project",
      cell: (p) => (
        <span className="flex items-start gap-3">
          <span className="pt-0.5">
            <ProjectGlyph project={p} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="font-medium text-ink">{p.name}</span>
            {p.description && <span className="line-clamp-1 text-ink-2">{p.description}</span>}
          </span>
        </span>
      ),
    },
    {
      key: "key",
      header: "Key",
      cell: (p) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="tabular-nums">{p.key}</span>
          {p.archived && <Badge tone="warning">Archived</Badge>}
        </span>
      ),
    },
    {
      key: "visibility",
      header: "Who can find it",
      cell: (p) =>
        p.isSystem ? (
          <Badge tone="info" icon={Lock}>
            App Admins only
          </Badge>
        ) : p.hidden ? (
          <Badge tone="info" icon={EyeOff}>
            Hidden: invite only
          </Badge>
        ) : (
          <Badge>Listed on the request screen</Badge>
        ),
    },
  ];

  return (
    <>
      <Table
        caption="Projects"
        captionHidden
        columns={columns}
        rows={projects.data ?? []}
        getRowKey={(p) => String(p.id)}
        rowActions={(p) =>
          p.isSystem ? (
            <span className="text-caption text-ink-2">Built in</span>
          ) : (
            <span className="flex flex-wrap justify-end gap-2">
              {!p.archived && (
                <Button variant="secondary" icon={Pencil} onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                  Edit
                </Button>
              )}
              {p.archived ? (
                <Button variant="secondary" icon={ArchiveRestore} onClick={() => void restore(p)} aria-label={`Restore ${p.name}`}>
                  Restore
                </Button>
              ) : (
                <Button variant="ghost" icon={Archive} onClick={() => setArchiving(p)} aria-label={`Archive ${p.name}`}>
                  Archive
                </Button>
              )}
            </span>
          )
        }
        empty={<EmptyState icon={FolderPlus} title="No projects yet. Create the first one." />}
      />
      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        title={`Archive ${archiving?.name ?? "this project"}?`}
        description="It becomes read-only for everyone: no new tasks, edits or comments until it's restored."
        confirmLabel="Archive project"
        confirmIcon={Archive}
        confirmAction={ADMIN_CONFIRM.archiveProject}
        confirmText={archiving?.key}
        successMessage="Project archived."
        onConfirm={async (headers) => {
          await api(`/api/projects/${archiving!.id}/archive`, { method: "POST", csrfToken: me.csrfToken, headers });
          await queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
          setArchiving(null);
        }}
      />
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing && (
          <ProjectFormDialog me={me} project={editing} onDone={() => setEditing(null)} />
        )}
      </Dialog>
    </>
  );
}

function CreateProjectButton({ me }: { me: MeResponse }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button icon={Plus} onClick={() => setOpen(true)}>
        New project
      </Button>
      {open && <ProjectFormDialog me={me} onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

type FormState = {
  name: string;
  key: string;
  description: string;
  colour: ProjectColour;
  icon: ProjectIcon;
  hidden: boolean;
};
type FieldName = keyof FormState;

/** A key suggested from the name until the admin types their own: "Welcome team" → "WELCOME". */
function suggestKey(name: string): string {
  const word = name.toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim().split(/\s+/)[0] ?? "";
  return word.replace(/^[0-9]+/, "").slice(0, 10);
}

function issuesByField(issues: z.core.$ZodIssue[]): Partial<Record<FieldName, string>> {
  const out: Partial<Record<FieldName, string>> = {};
  for (const issue of issues) {
    const field = issue.path[0] as FieldName | undefined;
    if (field && !out[field]) out[field] = issue.message;
  }
  return out;
}

/** Create (no `project`) or edit an existing project. Rendered inside an open <Dialog>. */
function ProjectFormDialog({ me, project, onDone }: { me: MeResponse; project?: ProjectSummary; onDone: () => void }) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [form, setForm] = useState<FormState>(
    project
      ? { name: project.name, key: project.key, description: project.description, colour: project.colour, icon: project.icon, hidden: project.hidden }
      : { name: "", key: "", description: "", colour: "blue", icon: "folder", hidden: false },
  );
  const [keyTouched, setKeyTouched] = useState(!!project);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  function set<K extends FieldName>(field: K, value: FormState[K]) {
    setForm((f) => ({
      ...f,
      [field]: value,
      ...(field === "name" && !keyTouched ? { key: suggestKey(value as string) } : {}),
    }));
    setErrors((e) => ({ ...e, [field]: undefined }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFailed(false);
    const parsed = project
      ? updateProjectBody.safeParse({ name: form.name, description: form.description, colour: form.colour, icon: form.icon, hidden: form.hidden })
      : createProjectBody.safeParse(form);
    if (!parsed.success) {
      setErrors(issuesByField(parsed.error.issues));
      return;
    }
    setSaving(true);
    try {
      const res = await api(project ? `/api/projects/${project.id}` : "/api/projects", {
        method: project ? "PATCH" : "POST",
        body: parsed.data,
        csrfToken: me.csrfToken,
      });
      const saved = projectResponse.parse(res).project;
      await queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
      // The access queue lists the projects this admin can invite people to.
      void queryClient.invalidateQueries({ queryKey: ["admin", "access-queue"] });
      queryClient.removeQueries({ queryKey: ["projects", "by-key", saved.key] });
      toast({ variant: "success", title: project ? PROJECT_COPY.saved : PROJECT_COPY.created });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === PROJECT_ERRORS.keyTaken) setErrors({ key: PROJECT_COPY.keyTaken });
      else if (err instanceof ApiError && err.status === 400) setErrors(issuesByField((err.body as { issues?: z.core.$ZodIssue[] })?.issues ?? []));
      else setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogContent
      title={project ? `Edit ${project.name}` : "New project"}
      description={project ? undefined : "Each team runs its own project. People ask to join it, or you invite them."}
      className="max-w-lg"
      footer={
        <>
          <Button variant="secondary" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" form={formId} icon={project ? undefined : Plus} loading={saving}>
            {project ? "Save changes" : "Create project"}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={submit} className="flex flex-col gap-group">
        <Field label="Name" required error={errors.name}>
          <TextInput value={form.name} maxLength={PROJECT_NAME_MAX} onChange={(e) => set("name", e.target.value)} autoComplete="off" />
        </Field>
        {project ? (
          <div className="flex flex-col gap-1">
            <span className="text-secondary font-medium text-ink">Key</span>
            <span className="text-body tabular-nums text-ink">{project.key}</span>
            <span className="text-caption text-ink-2">Task keys use it, so it can't change.</span>
          </div>
        ) : (
          <Field label="Key" required hint="2 to 10 letters or numbers. Task keys use it, like MEDIA-42, and it can't change later." error={errors.key}>
            <TextInput
              value={form.key}
              maxLength={10}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="uppercase tabular-nums"
              onChange={(e) => {
                setKeyTouched(true);
                set("key", e.target.value.toUpperCase());
              }}
            />
          </Field>
        )}
        <Field label="Description" error={errors.description}>
          <Textarea rows={3} maxLength={PROJECT_DESCRIPTION_MAX} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <ChoiceGrid
          legend="Colour"
          value={form.colour}
          onChange={(v) => set("colour", v as ProjectColour)}
          error={errors.colour}
          options={PROJECT_COLOURS.map((c) => ({
            value: c,
            label: PROJECT_COLOUR_CLASSES[c].label,
            content: <span className={cn("size-6 rounded-full", PROJECT_COLOUR_CLASSES[c].bg)} />,
          }))}
        />
        <ChoiceGrid
          legend="Icon"
          value={form.icon}
          onChange={(v) => set("icon", v as ProjectIcon)}
          error={errors.icon}
          options={PROJECT_ICONS.map((i) => ({
            value: i,
            label: PROJECT_ICON_LABELS[i],
            content: <Icon icon={PROJECT_ICON_COMPONENTS[i]} className={PROJECT_COLOUR_CLASSES[form.colour].text} />,
          }))}
        />
        <Switch
          label="Hidden (invite only)"
          hint="Hidden projects don't appear on the request screen. People join by invite link only."
          checked={form.hidden}
          onCheckedChange={(v) => set("hidden", v)}
        />
        {failed && (
          <p role="alert" className="rounded-control bg-danger-soft p-3 text-secondary text-danger-ink">
            {FAILED}
          </p>
        )}
      </form>
    </DialogContent>
  );
}

/** A row of square radio choices (swatches, icons). Selected = thick accent border and tint, not colour alone. */
function ChoiceGrid({
  legend,
  value,
  onChange,
  options,
  error,
}: {
  legend: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; content: ReactNode }[];
  error?: string;
}) {
  const id = useId();
  const selected = options.find((o) => o.value === value);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend id={`${id}-legend`} className="mb-2 text-secondary font-medium text-ink">
        {legend}
        {selected && <span className="font-normal text-ink-2">: {selected.label}</span>}
      </legend>
      <RadixRadioGroup.Root
        aria-labelledby={`${id}-legend`}
        aria-describedby={error ? `${id}-error` : undefined}
        value={value}
        onValueChange={onChange}
        orientation="horizontal"
        className="flex flex-wrap gap-2"
      >
        {options.map((o) => (
          <RadixRadioGroup.Item
            key={o.value}
            value={o.value}
            aria-label={o.label}
            className={cn(
              "inline-flex size-touch items-center justify-center rounded-control border border-line-strong bg-card",
              "transition-colors duration-(--duration-micro) ease-out state-hover:bg-hover",
              "data-[state=checked]:border-2 data-[state=checked]:border-accent-ink data-[state=checked]:bg-accent-soft",
            )}
          >
            {o.content}
          </RadixRadioGroup.Item>
        ))}
      </RadixRadioGroup.Root>
      <FieldError id={`${id}-error`} error={error} />
    </fieldset>
  );
}
