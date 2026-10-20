import { useQuery } from "@tanstack/react-query";
import { AtSign, CircleCheck, FolderPlus } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ACCESS_COPY } from "../../shared/access";
import { dueStatus, todayIn } from "../../shared/tasks";
import { WORK_COPY, type WorkTask, workResponse } from "../../shared/work";
import { ProjectGlyph, useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { DueBadge, PriorityIndicator, TypeIcon } from "../components/tasks/bits";
import { buttonClasses } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Skeleton, useDelayedFlag } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { api } from "../lib/api";
import { welcomeLine } from "../lib/greeting";
import { useMyProjects } from "../lib/projects";

// My Work (section 11.1, NAV-3), the first screen after an approved sign-in: Overdue → This week → Later,
// then unread mentions. Dates in the person's own timezone; no decorative metrics.

export { WORK_COPY };

export const taskLink = (t: Pick<WorkTask, "key" | "project">) => `/projects/${t.project.key}?task=${t.key}`;

export function TaskRow({ task, today }: { task: WorkTask; today: string }) {
  return (
    <li>
      <Link
        to={taskLink(task)}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-line bg-card px-3 py-2 transition-colors duration-(--duration-micro) ease-out state-hover:bg-hover"
      >
        <ProjectGlyph project={task.project} size="sm" />
        <span className="flex items-center gap-1 text-label text-ink-2 tabular-nums">
          <TypeIcon type={task.type} />
          {task.key}
        </span>
        <span className="min-w-0 flex-1 basis-48 text-secondary font-medium text-ink">{task.title}</span>
        <span className="flex items-center gap-2">
          <PriorityIndicator priority={task.priority} />
          <span className="text-caption text-ink-2">{task.stateName}</span>
          <DueBadge dueDate={task.dueDate} today={today} />
        </span>
      </Link>
    </li>
  );
}

function Group({ title, tasks, today }: { title: string; tasks: WorkTask[]; today: string }) {
  if (tasks.length === 0) return null;
  const id = `work-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="flex items-center gap-2 text-body font-semibold text-ink">
        {title}
        <span className="text-secondary font-normal text-ink-2 tabular-nums">{tasks.length}</span>
      </h2>
      <ul className="flex flex-col gap-2">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} today={today} />
        ))}
      </ul>
    </section>
  );
}

export function WorkPage() {
  const me = useMe();
  const projects = useMyProjects();
  const work = useQuery({ queryKey: ["work"], queryFn: async () => workResponse.parse(await api("/api/me/work")) });
  const loading = projects.isPending || work.isPending;
  const showSkeleton = useDelayedFlag(loading);
  const today = todayIn(me.user.timezone);

  let content: ReactNode;
  if (loading) {
    content = (
      <div aria-busy="true" aria-label="Loading your work" className="flex flex-col gap-3">
        {showSkeleton && (
          <>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </>
        )}
      </div>
    );
  } else if (projects.isError || work.isError) {
    content = (
      <ErrorState
        title="We couldn't load your work."
        description="Check your connection and try again."
        onRetry={() => {
          void projects.refetch();
          void work.refetch();
        }}
        retrying={projects.isFetching || work.isFetching}
      />
    );
  } else if (projects.data!.length === 0) {
    content = (
      <EmptyState
        icon={FolderPlus}
        title={ACCESS_COPY.noProjects}
        action={
          <Link to="/request-access" className={buttonClasses()}>
            Request access
          </Link>
        }
      />
    );
  } else {
    const { tasks, mentions } = work.data!;
    const overdue = tasks.filter((t) => dueStatus(t.dueDate, today) === "overdue");
    const thisWeek = tasks.filter((t) => dueStatus(t.dueDate, today) === "soon");
    const later = tasks.filter((t) => {
      const s = dueStatus(t.dueDate, today);
      return s === "later" || s === null;
    });
    content = (
      <>
        {tasks.length === 0 ? (
          <EmptyState
            icon={CircleCheck}
            title={WORK_COPY.allCaughtUp}
            action={
              <Link to="/projects" className={buttonClasses()}>
                Go to projects
              </Link>
            }
          />
        ) : (
          <>
            <Group title="Overdue" tasks={overdue} today={today} />
            <Group title="This week" tasks={thisWeek} today={today} />
            <Group title="Later" tasks={later} today={today} />
          </>
        )}
        {mentions.length > 0 && (
          <section aria-labelledby="work-mentions" className="flex flex-col gap-2">
            <h2 id="work-mentions" className="flex items-center gap-2 text-body font-semibold text-ink">
              <Icon icon={AtSign} className="text-accent-ink" />
              Mentioned you
            </h2>
            <ul className="flex flex-col gap-2">
              {mentions.map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/projects/${m.projectKey}?task=${m.taskKey}`}
                    className="flex flex-col rounded-control border border-info-line bg-info-soft px-3 py-2 state-hover:bg-hover"
                  >
                    <span className="text-secondary text-ink">
                      <span className="font-medium">{m.by}</span> mentioned you {m.inComment ? "in a comment on" : "in"}{" "}
                      <span className="tabular-nums">{m.taskKey}</span>
                    </span>
                    <span className="text-caption text-ink-2">{m.taskTitle}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  return (
    <PageLayout title="My Work" intro={welcomeLine(me.user.timezone)}>
      {content}
    </PageLayout>
  );
}
