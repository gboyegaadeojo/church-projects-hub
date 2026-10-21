import { useQuery } from "@tanstack/react-query";
import { Kanban, Layers, Lock, Plus, SearchX, Settings2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { MeResponse } from "../../shared/auth";
import {
  clearDrill,
  describeDrill,
  drillFromSearch,
  EMPTY_FILTER,
  filterFromSearch,
  filterToSearch,
  isDrillActive,
  matchesDrill,
  matchesFilter,
  type TaskFilter,
} from "../../shared/filters";
import { projectResponse, type ProjectSummary } from "../../shared/projects";
import { type BulkEditBody, TASK_COPY, type TaskCard, type TaskType, todayIn } from "../../shared/tasks";
import { ProjectTile, useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { ProjectTabs, type WorkView } from "../components/shell/ProjectTabs";
import { BacklogView } from "../components/tasks/BacklogView";
import { BoardToolbar } from "../components/tasks/BoardToolbar";
import { EpicsView } from "../components/tasks/EpicsView";
import { Board } from "../components/tasks/Board";
import { BulkBar } from "../components/tasks/BulkBar";
import { NewTaskPanel, TaskDetailSheet } from "../components/tasks/TaskDetailSheet";
import { TaskList } from "../components/tasks/TaskList";
import { Button, buttonClasses } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { toast } from "../components/ui/Toast";
import { api, ApiError } from "../lib/api";
import { OfflineDisabled } from "../components/StatusBanners";
import { useOnline } from "../lib/online";
import { type MoveInput, peopleById, useBoard, useBulkEdit, useMoveTask } from "../lib/tasks";
import { useBlockReason } from "../components/tasks/BlockReasonDialog";
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

function ProjectWork({ project }: { project: ProjectSummary }) {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const viewParam = params.get("view");
  const view: WorkView = viewParam === "list" || viewParam === "backlog" || viewParam === "epics" ? viewParam : "board";
  const taskParam = params.get("task");
  const filter = useMemo(() => filterFromSearch(params), [params]);
  const board = useBoard(project.id);
  const move = useMoveTask(project.id, me.csrfToken);
  const bulk = useBulkEdit(project.id, me.csrfToken);
  // Open with the type to create: "epic" from the Epics view, otherwise a task.
  const [creating, setCreating] = useState<TaskType | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const showSkeleton = useDelayedFlag(board.isPending);
  // Section 11.10: no edits offline in v1; reconnecting brings them back without a reload.
  const online = useOnline();
  const canEdit = canEditTasks(me, project) && online;
  const today = todayIn(me.user.timezone);

  const setFilter = (f: TaskFilter) => setParams((p) => filterToSearch(f, p), { replace: true });
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
    if (canEdit) setCreating("task");
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
  // Section 16 "View tasks": a report's drill-down narrows the board further until cleared.
  const drill = useMemo(() => drillFromSearch(params), [params]);
  const categoryOf = useMemo(() => {
    const m = new Map((data?.states ?? []).map((s) => [s.id, s.category]));
    return (id: number) => m.get(id);
  }, [data?.states]);
  const visible = useMemo(
    () => (data?.tasks ?? []).filter((t) => matchesFilter(t, filter, today) && matchesDrill(t, drill, categoryOf, today)),
    [data?.tasks, filter, drill, categoryOf, today],
  );
  const doneState = data?.states.find((s) => s.category === "done");

  // v4.7: every move into a blocking column asks why first; cancelling leaves the task where it was.
  const blockReason = useBlockReason();
  const blocksTo = (stateId: number) => data?.states.find((s) => s.id === stateId);
  async function requestMove(input: MoveInput) {
    const target = blocksTo(input.stateId);
    const from = blocksTo(input.task.stateId);
    if (target?.blocks && !from?.blocks) {
      const reason = await blockReason.ask(input.task.key, target.name);
      if (!reason) return;
      move.mutate({ ...input, blockedReason: reason });
      return;
    }
    move.mutate(input);
  }

  async function applyBulk(ids: number[], changes: Omit<BulkEditBody, "taskIds">, message?: string) {
    const target = changes.stateId !== undefined ? blocksTo(changes.stateId) : undefined;
    if (target?.blocks) {
      const reason = await blockReason.ask(ids.length === 1 ? "this task" : `these ${ids.length} tasks`, target.name);
      if (!reason) return;
      changes = { ...changes, blockedReason: reason };
    }
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
    <span className="flex flex-col gap-2">
      {project.description && <span>{project.description}</span>}
      <span className="flex flex-wrap items-center gap-2">
        <span className="rounded-chip bg-hover px-2 py-0.5 text-label text-ink-2 tabular-nums">{project.key}</span>
        <ProjectBadges project={project} />
      </span>
    </span>
  );

  return (
    <PageLayout
      wide
      title={project.name}
      breadcrumbs={[{ to: "/projects", label: "Projects" }]}
      leading={<ProjectTile project={project} size="lg" />}
      intro={header}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {(me.user.appRole === "admin" || project.role === "admin") && (
            <Link to={`/projects/${project.key}/settings`} className={buttonClasses("ghost")}>
              <Icon icon={Settings2} />
              Project settings
            </Link>
          )}
          {canEdit && (
            <Button icon={Plus} onClick={() => setCreating("task")} disabled={!data}>
              New task
            </Button>
          )}
          {/* Section 11.10: offline, write controls stay visible but disabled, with the reason. */}
          {!online && canEditTasks(me, project) && <OfflineDisabled label="New task" icon={Plus} />}
        </div>
      }
    >
      {/* PROJ-5: Members lists who's on the project; its admins manage roles there. */}
      <ProjectTabs projectKey={project.key} active={view} />
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
              <Button icon={Plus} onClick={() => setCreating("task")}>
                New task
              </Button>
            )
          }
        />
      ) : (
        <>
          <BoardToolbar
            projectId={project.id}
            filter={filter}
            onChange={setFilter}
            tasks={data.tasks}
            members={data.members}
            labels={data.labels}
            meId={me.user.id}
            today={today}
            csrfToken={me.csrfToken}
            canShare={canEdit}
            canManageShared={me.user.appRole === "admin" || project.role === "admin"}
          >
            {view === "epics" && canEdit && (
              <Button variant="secondary" icon={Layers} onClick={() => setCreating("epic")}>
                New epic
              </Button>
            )}
          </BoardToolbar>
          {isDrillActive(drill) && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-accent-soft bg-accent-soft px-4 py-2 text-secondary text-accent-ink">
              <span>
                From a report: showing{" "}
                {describeDrill(drill, {
                  milestone: data.milestones.find((m) => m.id === drill.milestone)?.name,
                  component: data.components.find((c) => c.id === drill.component)?.name,
                  category: { todo: "To do", in_progress: "In progress", done: "Done" }[drill.category as "todo"],
                })}
                .
              </span>
              <Button variant="ghost" onClick={() => setParams((p) => clearDrill(p), { replace: true })}>
                Show all tasks
              </Button>
            </div>
          )}
          {view === "epics" ? (
            <EpicsView
              states={data.states}
              allTasks={data.tasks}
              tasks={visible}
              people={people}
              today={today}
              search={filter.q}
              canEdit={canEdit}
              onOpen={openTask}
              onNewEpic={() => setCreating("epic")}
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No tasks match these filters."
              action={
                <Button variant="secondary" onClick={() => setFilter(EMPTY_FILTER)}>
                  Clear filters
                </Button>
              }
            />
          ) : view === "backlog" ? (
            <BacklogView
              projectId={project.id}
              projectKey={project.key}
              csrfToken={me.csrfToken}
              states={data.states}
              tasks={visible}
              labels={labels}
              people={people}
              today={today}
              canEdit={canEdit}
              onOpen={openTask}
              onMove={(input) => void requestMove(input)}
            />
          ) : view === "board" ? (
            <Board
              states={data.states}
              tasks={visible}
              labels={labels}
              people={people}
              today={today}
              canMove={canEdit}
              offline={!online && canEditTasks(me, project)}
              onOpen={openTask}
              onMove={(input) => void requestMove(input)}
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
              onReassign={(task, assigneeId) => void applyBulk([task.id], { assigneeId }, `${task.key} reassigned.`)}
            />
          )}
          {view === "list" && selected.size > 0 && canEdit && (
            <BulkBar
              count={selected.size}
              states={data.states}
              assignable={assignable}
              labels={data.labels}
              pending={bulk.isPending}
              onApply={(changes) => void applyBulk([...selected], changes)}
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
        // v4.7: the same modal as an existing task. Remounted per type, so it starts from the right type.
        <NewTaskPanel
          key={creating ?? "closed"}
          open={creating !== null}
          onOpenChange={(open) => !open && setCreating(null)}
          defaultType={creating ?? "task"}
          board={data}
          project={project}
          me={me}
          onCreated={openTask}
        />
      )}
      {blockReason.dialog}
    </PageLayout>
  );
}
