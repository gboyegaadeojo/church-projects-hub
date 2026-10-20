import { useQuery } from "@tanstack/react-query";
import { Kanban, List, Lock, Plus, SearchX, Settings2, SlidersHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { MeResponse } from "../../shared/auth";
import { filterFromSearch, filterToSearch, isFilterActive, matchesFilter, type TaskFilter } from "../../shared/filters";
import { projectResponse, type ProjectSummary } from "../../shared/projects";
import { type BulkEditBody, TASK_COPY, type TaskCard, todayIn } from "../../shared/tasks";
import { ProjectGlyph, useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Board } from "../components/tasks/Board";
import { BulkBar } from "../components/tasks/BulkBar";
import { FilterBar } from "../components/tasks/FilterBar";
import { NewTaskDialog } from "../components/tasks/NewTaskDialog";
import { TaskDetailSheet } from "../components/tasks/TaskDetailSheet";
import { TaskList } from "../components/tasks/TaskList";
import { Button, buttonClasses } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { toast } from "../components/ui/Toast";
import { api, ApiError } from "../lib/api";
import { cn } from "../lib/cn";
import { useOnline } from "../lib/online";
import { peopleById, useBoard, useBulkEdit, useMoveTask } from "../lib/tasks";
import { ProjectBadges } from "./ProjectsPage";

// A project's work (sections 11.2, 12): board or list, filters in the URL, new task, bulk edit.
// The task detail opens over the page from ?task=KEY, so the board keeps its scroll and filters.

export function ProjectPage() {
  const { key = "" } = useParams();
  const project = useQuery({
    queryKey: ["projects", "by-key", key.toUpperCase()],
    queryFn: async () => projectResponse.parse(await api(`/api/projects/by-key/${encodeURIComponent(key)}`)).project,
    retry: (count, err) => !(err instanceof ApiError && (err.status === 403 || err.status === 404)) && count < 2,
  });
  const showSkeleton = useDelayedFlag(project.isPending);

  if (project.isPending) {
    return (
      <PageLayout title="Project">
        <div aria-busy="true" aria-label="Loading project">
          {showSkeleton && <Skeleton className="h-24 w-full rounded-card" />}
        </div>
      </PageLayout>
    );
  }
  if (project.isError) {
    const status = project.error instanceof ApiError ? project.error.status : 0;
    return (
      <PageLayout title="Project">
        {status === 404 ? (
          <EmptyState
            icon={SearchX}
            title="We couldn't find that project. Check the link, or pick one from your projects."
            action={
              <Link to="/projects" className={buttonClasses()}>
                Go to projects
              </Link>
            }
          />
        ) : status === 403 ? (
          <EmptyState
            icon={Lock}
            title="You don't have access to this project. Ask its admin, or request access."
            action={
              <Link to="/request-access" className={buttonClasses()}>
                Request access
              </Link>
            }
          />
        ) : (
          <ErrorState
            title="We couldn't load this project."
            description="Check your connection and try again."
            onRetry={() => void project.refetch()}
            retrying={project.isFetching}
          />
        )}
      </PageLayout>
    );
  }
  return <ProjectWork project={project.data} />;
}

/** Only these roles change tasks (section 2); an archived project is read-only (PROJ-4). The API checks too. */
export function canEditTasks(me: MeResponse, project: ProjectSummary): boolean {
  if (project.archived) return false;
  return me.user.appRole === "admin" || project.role === "admin" || project.role === "contributor";
}

function ViewSwitch({ view, onChange }: { view: "board" | "list"; onChange: (v: "board" | "list") => void }) {
  const option = (value: "board" | "list", label: string, icon: typeof Kanban) => (
    <button
      type="button"
      aria-pressed={view === value}
      onClick={() => onChange(value)}
      className={cn(
        "inline-flex min-h-touch items-center gap-2 rounded-chip px-3 text-secondary",
        view === value ? "bg-card font-medium text-ink shadow-raised" : "text-ink-2 state-hover:text-ink",
      )}
    >
      <Icon icon={icon} size="sm" />
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="View" className="inline-flex gap-1 rounded-control bg-hover p-1">
      {option("board", "Board", Kanban)}
      {option("list", "List", List)}
    </div>
  );
}

function ProjectWork({ project }: { project: ProjectSummary }) {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "list" ? "list" : "board";
  const taskParam = params.get("task");
  const filter = useMemo(() => filterFromSearch(params), [params]);
  const board = useBoard(project.id);
  const move = useMoveTask(project.id, me.csrfToken);
  const bulk = useBulkEdit(project.id, me.csrfToken);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const showSkeleton = useDelayedFlag(board.isPending);
  // Section 11.10: no edits offline in v1; reconnecting brings them back without a reload.
  const online = useOnline();
  const canEdit = canEditTasks(me, project) && online;
  const today = todayIn(me.user.timezone);

  const setFilter = (f: TaskFilter) => setParams((p) => filterToSearch(f, p), { replace: true });
  const setView = (v: "board" | "list") =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      if (v === "list") next.set("view", "list");
      else next.delete("view");
      return next;
    });
  const openTask = (task: Pick<TaskCard, "key">) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("task", task.key);
      return next;
    });

  const data = board.data;

  // The command palette's "New task" lands here with ?new=1 (NAV-2).
  useEffect(() => {
    if (params.get("new") !== "1" || !data) return;
    if (canEdit) setCreating(true);
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete("new");
        return next;
      },
      { replace: true },
    );
  }, [params, data, canEdit, setParams]);
  const labels = useMemo(() => new Map((data?.labels ?? []).map((l) => [l.id, l])), [data?.labels]);
  const people = useMemo(() => (data ? peopleById(data) : new Map()), [data]);
  const assignable = useMemo(() => (data?.members ?? []).filter((m) => m.role !== "viewer"), [data?.members]);
  const visible = useMemo(() => (data?.tasks ?? []).filter((t) => matchesFilter(t, filter)), [data?.tasks, filter]);
  const doneState = data?.states.find((s) => s.category === "done");

  function applyBulk(ids: number[], changes: Omit<BulkEditBody, "taskIds">, message?: string) {
    bulk.mutate(
      { taskIds: ids, ...changes },
      {
        onSuccess: ({ updated }) => {
          toast({ variant: "success", title: message ?? (updated === 1 ? "Updated 1 task." : `Updated ${updated} tasks.`) });
        },
        onError: () => toast({ variant: "error", title: TASK_COPY.saveFailed }),
      },
    );
  }

  const header: ReactNode = (
    <span className="flex flex-col gap-3">
      <span className="flex items-center gap-2 text-secondary">
        <ProjectGlyph project={project} size="sm" />
        <span className="tabular-nums">{project.key}</span>
      </span>
      {project.description && <span>{project.description}</span>}
      <ProjectBadges project={project} />
    </span>
  );

  return (
    <PageLayout
      wide
      title={project.name}
      intro={header}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {me.user.appRole === "admin" && !project.isSystem && (
            <Link to="/admin/projects" className={buttonClasses("secondary")}>
              <Icon icon={Settings2} />
              Edit project
            </Link>
          )}
          {canEdit && (
            <Button icon={Plus} onClick={() => setCreating(true)} disabled={!data}>
              New task
            </Button>
          )}
        </div>
      }
    >
      {board.isPending ? (
        <div aria-busy="true" aria-label="Loading tasks" className="flex gap-4 overflow-hidden">
          {showSkeleton && [0, 1, 2].map((i) => <Skeleton key={i} className="h-64 w-72 shrink-0 rounded-card" />)}
        </div>
      ) : board.isError || !data ? (
        <ErrorState
          title="We couldn't load the tasks."
          description="Check your connection and try again."
          onRetry={() => void board.refetch()}
          retrying={board.isFetching}
        />
      ) : data.tasks.length === 0 ? (
        <EmptyState
          icon={Kanban}
          title={TASK_COPY.emptyBoard}
          action={
            canEdit && (
              <Button icon={Plus} onClick={() => setCreating(true)}>
                New task
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ViewSwitch view={view} onChange={setView} />
            {/* Phones: filters fold away behind one button to keep the board in reach. */}
            <Button
              variant="secondary"
              icon={SlidersHorizontal}
              className="md:hidden"
              aria-expanded={filtersOpen}
              aria-controls="task-filters"
              onClick={() => setFiltersOpen((o) => !o)}
            >
              Filters{isFilterActive(filter) ? " (on)" : ""}
            </Button>
          </div>
          <div id="task-filters" className={cn(!filtersOpen && "hidden", "md:block")}>
            <FilterBar
              projectId={project.id}
              filter={filter}
              onChange={setFilter}
              members={data.members}
              labels={data.labels}
              meId={me.user.id}
              csrfToken={me.csrfToken}
              canShare={canEdit}
              canManageShared={me.user.appRole === "admin" || project.role === "admin"}
            />
          </div>
          {visible.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No tasks match these filters."
              action={
                <Button variant="secondary" onClick={() => setFilter({ assignees: [], labels: [], priorities: [], scopes: [] })}>
                  Clear filters
                </Button>
              }
            />
          ) : view === "board" ? (
            <Board
              states={data.states}
              tasks={visible}
              labels={labels}
              people={people}
              today={today}
              canMove={canEdit}
              onOpen={openTask}
              onMove={(input) => move.mutate(input)}
            />
          ) : (
            <TaskList
              states={data.states}
              tasks={visible}
              labels={labels}
              people={people}
              assignable={assignable}
              today={today}
              canEdit={canEdit}
              selected={selected}
              onSelectedChange={setSelected}
              onOpen={openTask}
              onComplete={(task) =>
                doneState && move.mutate({ task, stateId: doneState.id, afterId: null, beforeId: null })
              }
              onReassign={(task, assigneeId) => applyBulk([task.id], { assigneeId }, `${task.key} reassigned.`)}
            />
          )}
          {view === "list" && selected.size > 0 && canEdit && (
            <BulkBar
              count={selected.size}
              states={data.states}
              assignable={assignable}
              labels={data.labels}
              pending={bulk.isPending}
              onApply={(changes) => applyBulk([...selected], changes)}
              onClear={() => setSelected(new Set())}
            />
          )}
        </>
      )}
      {data && taskParam && (
        <TaskDetailSheet
          taskKey={taskParam}
          board={data}
          project={project}
          me={me}
          canEdit={canEdit}
          onClose={() =>
            setParams((p) => {
              const next = new URLSearchParams(p);
              next.delete("task");
              return next;
            })
          }
        />
      )}
      {data && canEdit && (
        <NewTaskDialog
          open={creating}
          onOpenChange={setCreating}
          projectId={project.id}
          csrfToken={me.csrfToken}
          states={data.states}
          assignable={assignable}
          onCreated={openTask}
        />
      )}
    </PageLayout>
  );
}
