import { ListFilter, Search, UserRound, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  activeFilterCount,
  DUE_FILTER_LABELS,
  DUE_FILTERS,
  EMPTY_FILTER,
  type FilterGroup,
  isFilterActive,
  matchesFilter,
  type TaskFilter,
  toggleIn,
} from "../../../shared/filters";
import {
  type Label,
  type Member,
  PRIORITIES,
  PRIORITY_LABELS,
  SCOPE_LABELS,
  SCOPES,
  TASK_TYPE_LABELS,
  TASK_TYPES,
  type TaskCard,
} from "../../../shared/tasks";
import { cn } from "../../lib/cn";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Menu";
import { LabelChip, TypeIcon } from "./bits";
import { SavedFilters } from "./FilterBar";
import { PriorityPill } from "./tones";

// The board, list, backlog and epics toolbar (section 11.2, v4.6), in the spirit of monday.com: a search box, the
// project's people as one-click avatar filters, "My tasks", and a Filter panel with every facet and how many tasks
// each value would show. Active filters are listed under the bar, each removable. Filters live in the URL.

type Option = { value: string | number; label: ReactNode; text: string };
type Facet = { group: FilterGroup; title: string; options: Option[] };

/** People shown as avatars before "+N" (the rest are in the Filter panel). */
const PEOPLE_SHOWN = 6;

export type BoardToolbarProps = {
  projectId: number;
  filter: TaskFilter;
  onChange: (f: TaskFilter) => void;
  /** Every task in the project, unfiltered: the facet counts come from these. */
  tasks: TaskCard[];
  members: Member[];
  labels: Label[];
  meId: number;
  today: string;
  csrfToken: string;
  canShare: boolean;
  canManageShared: boolean;
  /** View-specific controls at the right end (e.g. "New epic"). */
  children?: ReactNode;
};

export function BoardToolbar({ projectId, filter, onChange, tasks, members, labels, meId, today, csrfToken, canShare, canManageShared, children }: BoardToolbarProps) {
  const epics = useMemo(() => tasks.filter((t) => t.type === "epic"), [tasks]);
  const facets: Facet[] = useMemo(
    () => [
      {
        group: "assignees",
        title: "Person",
        options: [
          { value: meId, label: "Me", text: "Me" },
          ...members.filter((m) => m.id !== meId).map((m) => ({ value: m.id, label: m.name, text: m.name })),
          { value: "none", label: "Unassigned", text: "Unassigned" },
        ],
      },
      { group: "priorities", title: "Priority", options: PRIORITIES.map((p) => ({ value: p, label: <PriorityPill priority={p} />, text: PRIORITY_LABELS[p] })) },
      { group: "due", title: "Due date", options: DUE_FILTERS.map((d) => ({ value: d, label: DUE_FILTER_LABELS[d], text: DUE_FILTER_LABELS[d] })) },
      {
        group: "types",
        title: "Type",
        options: TASK_TYPES.map((t) => ({
          value: t,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <TypeIcon type={t} />
              {TASK_TYPE_LABELS[t]}
            </span>
          ),
          text: TASK_TYPE_LABELS[t],
        })),
      },
      { group: "labels", title: "Label", options: labels.map((l) => ({ value: l.id, label: <LabelChip label={l} />, text: l.name })) },
      {
        group: "epics",
        title: "Epic",
        options: [...epics.map((e) => ({ value: e.id, label: e.title, text: e.title })), { value: "none", label: "No epic", text: "No epic" }],
      },
      { group: "scopes", title: "Scope", options: SCOPES.map((s) => ({ value: s, label: SCOPE_LABELS[s], text: SCOPE_LABELS[s] })) },
    ],
    [members, labels, epics, meId],
  );

  /** How many tasks each value would show, with the other groups' filters still applied (like faceted search). */
  const count = (group: FilterGroup, value: string | number) => {
    const others = { ...filter, [group]: [value] } as TaskFilter;
    return tasks.filter((t) => matchesFilter(t, others, today)).length;
  };

  const set = (group: FilterGroup, values: (string | number)[]) => onChange({ ...filter, [group]: values } as TaskFilter);
  const toggle = (group: FilterGroup, value: string | number) => set(group, toggleIn(filter[group] as (string | number)[], value));
  const n = activeFilterCount(filter);
  const mine = filter.assignees.length === 1 && filter.assignees[0] === meId;
  const me = members.find((m) => m.id === meId);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <SearchBox value={filter.q} onChange={(q) => onChange({ ...filter, q })} />
        <PeopleFilter members={members} meId={meId} selected={filter.assignees} onToggle={(id) => toggle("assignees", id)} />
        {/* v4.7: the quickest way to your own work, so it stands out: tinted when off, solid when on. */}
        <button
          type="button"
          aria-pressed={mine}
          onClick={() => set("assignees", mine ? [] : [meId])}
          className={cn(
            "inline-flex min-h-touch items-center gap-2 rounded-pill border pr-3.5 pl-1 text-secondary font-semibold",
            "transition-colors duration-(--duration-micro) ease-out",
            mine ? "border-accent bg-accent text-on-accent state-hover:bg-accent-hover" : "border-accent bg-accent-soft text-accent-ink state-hover:bg-card",
          )}
        >
          {me ? <Avatar name={me.name} url={me.avatarUrl} size="xs" className={cn("ring-2", mine ? "ring-accent" : "ring-card")} /> : <Icon icon={UserRound} size="sm" className="ml-1.5" />}
          My tasks
          {mine && <Icon icon={X} size="sm" className="-mr-1" />}
        </button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant={n > 0 ? "secondary" : "ghost"} icon={ListFilter} className={cn(n > 0 && "border-accent text-accent-ink")}>
              Filter
              {n > 0 && (
                <span className="rounded-pill bg-accent px-1.5 text-label font-semibold text-on-accent tabular-nums">
                  {n}
                  <span className="sr-only"> on</span>
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" aria-label="Filter tasks" className="w-[min(46rem,calc(100vw-2rem))] p-0">
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
              <span className="text-secondary font-semibold text-ink">Filter tasks</span>
              {isFilterActive(filter) && (
                <Button variant="ghost" className="text-caption" onClick={() => onChange(EMPTY_FILTER)}>
                  Clear all
                </Button>
              )}
            </div>
            <div className="grid max-h-[60dvh] gap-x-4 gap-y-3 overflow-y-auto p-4 sm:grid-cols-2 lg:grid-cols-3">
              {facets.map((facet) => (
                <fieldset key={facet.group} className="flex min-w-0 flex-col gap-0.5">
                  <legend className="mb-1 text-label font-semibold tracking-wide text-ink-2 uppercase">{facet.title}</legend>
                  {facet.options.length === 0 && <p className="text-caption text-ink-2">None in this project yet.</p>}
                  {facet.options.map((o) => {
                    const on = (filter[facet.group] as (string | number)[]).includes(o.value);
                    return (
                      <button
                        key={String(o.value)}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(facet.group, o.value)}
                        className={cn(
                          "flex min-h-touch items-center gap-2 rounded-control px-2 text-left text-secondary text-ink",
                          "transition-colors duration-(--duration-micro) ease-out state-hover:bg-hover",
                          on && "bg-accent-soft font-medium text-accent-ink state-hover:bg-accent-soft",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        <span className="text-caption text-ink-2 tabular-nums">{count(facet.group, o.value)}</span>
                      </button>
                    );
                  })}
                </fieldset>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <SavedFilters projectId={projectId} filter={filter} onApply={onChange} meId={meId} csrfToken={csrfToken} canShare={canShare} canManageShared={canManageShared} />
        {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
      </div>
      {isFilterActive(filter) && <ActiveFilters filter={filter} facets={facets} onToggle={toggle} onSearch={(q) => onChange({ ...filter, q })} onClear={() => onChange(EMPTY_FILTER)} />}
    </div>
  );
}

/** Text search over titles and keys; updates the URL a moment after typing stops. */
function SearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text.trim() === value) return;
    const timer = setTimeout(() => onChange(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text, value, onChange]);
  return (
    <label className="relative flex min-h-touch w-full items-center sm:w-56">
      <span className="sr-only">Search this project's tasks</span>
      <Icon icon={Search} size="sm" className="pointer-events-none absolute left-2.5 text-ink-2" />
      <input
        type="search"
        value={text}
        maxLength={100}
        placeholder="Search tasks"
        onChange={(e) => setText(e.target.value)}
        className="min-h-touch w-full rounded-control border border-line bg-card pr-2 pl-8 text-secondary text-ink placeholder:text-ink-2 state-hover:border-line-strong"
      />
    </label>
  );
}

/** The project's people as avatars; pressing one shows only their tasks (as assignee or secondary assignee). */
function PeopleFilter({ members, meId, selected, onToggle }: { members: Member[]; meId: number; selected: TaskFilter["assignees"]; onToggle: (id: number) => void }) {
  const people = members.filter((m) => m.role !== "viewer");
  // The people already filtered on always stay visible.
  const shown = [...people.filter((m) => selected.includes(m.id)), ...people.filter((m) => !selected.includes(m.id) && m.id !== meId)].slice(0, PEOPLE_SHOWN);
  if (shown.length === 0) return null;
  const hidden = people.length - shown.length - (people.some((m) => m.id === meId) && !shown.some((m) => m.id === meId) ? 1 : 0);
  return (
    <div role="group" aria-label="Filter by person" className="hidden items-center sm:flex">
      {shown.map((m, i) => {
        const on = selected.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            aria-pressed={on}
            title={m.name}
            onClick={() => onToggle(m.id)}
            className={cn(
              "relative inline-flex size-touch items-center justify-center rounded-full transition-transform duration-(--duration-micro) ease-out state-hover:z-10 state-hover:-translate-y-0.5",
              i > 0 && "-ml-2",
              on && "z-10",
            )}
          >
            <Avatar name={m.name} url={m.avatarUrl} size="sm" className={cn("ring-2", on ? "ring-accent" : "ring-card")} />
            <span className="sr-only">{m.name}</span>
          </button>
        );
      })}
      {hidden > 0 && <span className="ml-1 text-caption text-ink-2 tabular-nums">+{hidden}</span>}
    </div>
  );
}

function ActiveFilters({
  filter,
  facets,
  onToggle,
  onSearch,
  onClear,
}: {
  filter: TaskFilter;
  facets: Facet[];
  onToggle: (group: FilterGroup, value: string | number) => void;
  onSearch: (q: string) => void;
  onClear: () => void;
}) {
  const chips: { key: string; text: string; remove: () => void }[] = [];
  if (filter.q) chips.push({ key: "q", text: `“${filter.q}”`, remove: () => onSearch("") });
  for (const facet of facets) {
    for (const value of filter[facet.group] as (string | number)[]) {
      const option = facet.options.find((o) => o.value === value);
      chips.push({ key: `${facet.group}-${value}`, text: `${facet.title}: ${option?.text ?? "Removed"}`, remove: () => onToggle(facet.group, value) });
    }
  }
  return (
    <ul aria-label="Active filters" className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <li key={c.key}>
          <span className="inline-flex items-center gap-1 rounded-pill border border-accent bg-accent-soft py-0.5 pr-0.5 pl-2.5 text-caption text-accent-ink">
            {c.text}
            <button type="button" onClick={c.remove} aria-label={`Remove ${c.text}`} className="inline-flex size-6 items-center justify-center rounded-full state-hover:bg-card">
              <Icon icon={X} size="sm" />
            </button>
          </span>
        </li>
      ))}
      <li>
        <Button variant="ghost" className="text-caption" onClick={onClear}>
          Clear filters
        </Button>
      </li>
    </ul>
  );
}
