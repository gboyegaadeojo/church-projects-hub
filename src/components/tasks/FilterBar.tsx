import { Bookmark, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { EMPTY_FILTER, type FilterGroup, isFilterActive, type SavedFilter, type TaskFilter, toggleIn } from "../../../shared/filters";
import { type Label, type Member, PRIORITIES, PRIORITY_LABELS, SCOPE_LABELS, SCOPES, TASK_CONFIRM } from "../../../shared/tasks";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { useSaveFilter, useSavedFilters } from "../../lib/tasks";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Checkbox, Switch } from "../ui/choices";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Dialog, DialogContent } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Icon } from "../ui/Icon";
import { TextInput } from "../ui/inputs";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "../ui/Menu";
import { toast } from "../ui/Toast";
import { LabelChip, PriorityIndicator } from "./bits";

// Filter bar (section 11.2): Assignee, Label, Priority and Scope chips; active filters look selected and say how
// many values they hold. Filters live in the URL, so they survive opening and closing a task. Saved filters (ORG-5).

type Option = { value: string | number; label: ReactNode; text: string };

function FilterChip({
  name,
  group,
  filter,
  options,
  onChange,
}: {
  name: string;
  group: FilterGroup;
  filter: TaskFilter;
  options: Option[];
  onChange: (f: TaskFilter) => void;
}) {
  const selected = filter[group] as (string | number)[];
  const active = selected.length > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex min-h-touch items-center gap-1 rounded-chip border px-3 text-secondary transition-colors duration-(--duration-menu) ease-out",
            active ? "border-accent bg-accent-soft text-accent-ink" : "border-line-strong bg-card text-ink state-hover:bg-hover",
          )}
        >
          {name}
          {active && (
            <span className="tabular-nums">
              <span className="sr-only">, </span>
              {selected.length}
              <span className="sr-only"> selected</span>
            </span>
          )}
          <Icon icon={ChevronDown} size="sm" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={`Filter by ${name.toLowerCase()}`} className="w-72 p-2">
        <div className="flex max-h-80 flex-col overflow-y-auto px-2">
          {options.length === 0 && <p className="py-3 text-secondary text-ink-2">Nothing to filter by yet.</p>}
          {options.map((o) => (
            <Checkbox
              key={String(o.value)}
              label={o.text}
              checked={selected.includes(o.value)}
              onCheckedChange={() => onChange({ ...filter, [group]: toggleIn(selected, o.value) })}
            />
          ))}
        </div>
        {active && (
          <div className="border-t border-line px-2 pt-2">
            <Button variant="ghost" onClick={() => onChange({ ...filter, [group]: [] })}>
              Clear {name.toLowerCase()}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export type FilterBarProps = {
  /** Section 16: reports filter by assignee, label and priority only, with no saved filters. */
  reports?: boolean;
  projectId: number;
  filter: TaskFilter;
  onChange: (f: TaskFilter) => void;
  members: Member[];
  labels: Label[];
  meId: number;
  csrfToken: string;
  /** Sharing a filter needs task edit rights; Project Admins can remove shared ones. */
  canShare: boolean;
  canManageShared: boolean;
  children?: ReactNode;
};

export function FilterBar({ projectId, filter, onChange, members, labels, meId, csrfToken, canShare, canManageShared, reports = false, children }: FilterBarProps) {
  const assigneeOptions: Option[] = [
    { value: meId, label: "Me", text: "Me" },
    ...members.filter((m) => m.id !== meId).map((m) => ({ value: m.id, label: m.name, text: m.name })),
    { value: "none", label: "Unassigned", text: "Unassigned" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
      <FilterChip name="Assignee" group="assignees" filter={filter} options={assigneeOptions} onChange={onChange} />
      <FilterChip
        name="Label"
        group="labels"
        filter={filter}
        options={labels.map((l) => ({ value: l.id, label: <LabelChip label={l} />, text: l.name }))}
        onChange={onChange}
      />
      <FilterChip
        name="Priority"
        group="priorities"
        filter={filter}
        options={PRIORITIES.map((p) => ({ value: p, label: <PriorityIndicator priority={p} withLabel />, text: PRIORITY_LABELS[p] }))}
        onChange={onChange}
      />
      {!reports && (
        <FilterChip
          name="Scope"
          group="scopes"
          filter={filter}
          options={SCOPES.map((s) => ({ value: s, label: SCOPE_LABELS[s], text: SCOPE_LABELS[s] }))}
          onChange={onChange}
        />
      )}
      {isFilterActive(filter) && (
        <Button variant="ghost" icon={X} onClick={() => onChange(EMPTY_FILTER)}>
          Clear filters
        </Button>
      )}
      {!reports && (
        <SavedFilters
          projectId={projectId}
          filter={filter}
          onApply={onChange}
          meId={meId}
          csrfToken={csrfToken}
          canShare={canShare}
          canManageShared={canManageShared}
        />
      )}
      {children}
    </div>
  );
}

export function SavedFilters({
  projectId,
  filter,
  onApply,
  meId,
  csrfToken,
  canShare,
  canManageShared,
}: {
  projectId: number;
  filter: TaskFilter;
  onApply: (f: TaskFilter) => void;
  meId: number;
  csrfToken: string;
  canShare: boolean;
  canManageShared: boolean;
}) {
  const filters = useSavedFilters(projectId);
  const save = useSaveFilter(projectId, csrfToken);
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string>();
  const [deleting, setDeleting] = useState<SavedFilter | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Name this filter.");
      return;
    }
    try {
      await save.mutateAsync({ name: name.trim(), query: filter, shared });
      setSaving(false);
      toast({ variant: "success", title: "Filter saved." });
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    }
  }

  const list = filters.data ?? [];
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" icon={Bookmark}>
            Saved filters
          </Button>
        </MenuTrigger>
        <MenuContent align="start">
          {list.length > 0 && <MenuLabel>Apply a saved filter</MenuLabel>}
          {list.map((f) => (
            <MenuItem key={f.id} onSelect={() => onApply(f.query)}>
              <span className="flex-1 truncate">{f.name}</span>
              {f.shared && <span className="text-label text-ink-2">Shared</span>}
            </MenuItem>
          ))}
          {list.length > 0 && <MenuSeparator />}
          <MenuItem
            icon={Plus}
            disabled={!isFilterActive(filter)}
            onSelect={() => {
              setName("");
              setShared(false);
              setError(undefined);
              setSaving(true);
            }}
          >
            Save current filter
          </MenuItem>
          {list
            .filter((f) => f.ownerId === meId || (f.shared && canManageShared))
            .map((f) => (
              <MenuItem key={`delete-${f.id}`} icon={Trash2} destructive onSelect={() => setDeleting(f)}>
                Delete “{f.name}”
              </MenuItem>
            ))}
        </MenuContent>
      </Menu>

      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent
          title="Save filter"
          footer={
            <>
              <Button variant="secondary" onClick={() => setSaving(false)}>
                Cancel
              </Button>
              <Button type="submit" form="save-filter" loading={save.isPending}>
                Save filter
              </Button>
            </>
          }
        >
          <form id="save-filter" onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <Field label="Name" required error={error}>
              <TextInput value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </Field>
            {canShare && (
              <Switch label="Share with everyone in this project" checked={shared} onCheckedChange={setShared} />
            )}
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete “${deleting?.name ?? ""}”?`}
        description={deleting?.shared ? "This removes the saved filter for everyone in the project." : "This removes your saved filter."}
        confirmLabel="Delete filter"
        confirmIcon={Trash2}
        confirmAction={TASK_CONFIRM.deleteSavedFilter}
        successMessage="Filter deleted."
        onConfirm={async (headers) => {
          await api(`/api/saved-filters/${deleting!.id}`, { method: "DELETE", csrfToken, headers });
          await queryClient.invalidateQueries({ queryKey: ["saved-filters", projectId] });
        }}
      />
    </>
  );
}
