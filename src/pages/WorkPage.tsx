import { useQuery } from "@tanstack/react-query";
import { AlarmClock, AtSign, CalendarClock, CalendarDays, CircleCheck, FolderPlus, type LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
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
import { cn } from "../lib/cn";
import { welcomeLine } from "../lib/greeting";
import { useMyProjects } from "../lib/projects";

// My Work (section 11.1, NAV-3), the first screen after an approved sign-in: Overdue → This week → Later,
// then unread mentions. Dates in the person's own timezone; no decorative metrics.

export { WORK_COPY };

export const taskLink = (t: Pick<WorkTask, "key" | "project">) => `/projects/${t.project.key}?task=${t.key}`;

export function TaskRow({ task, today, index = 0 }: { task: WorkTask; today: string; index?: number }) {
  return (
    <li style={{ "--i": index } as CSSProperties}>
      <Link
        to={taskLink(task)}
        className="lift flex min-h-touch flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-line bg-card px-4 py-3 shadow-raised state-hover:border-accent"
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

/** Each group has its own icon and tint, so urgency reads at a glance (never by colour alone: the title says it). */
const GROUP_STYLE: Record<"Overdue" | "This week" | "Later", { icon: LucideIcon; tint: string }> = {
  Overdue: { icon: AlarmClock, tint: "bg-overdue-soft text-overdue-ink" },
  "This week": { icon: CalendarClock, tint: "bg-due-soon-soft text-due-soon-ink" },
  Later: { icon: CalendarDays, tint: "bg-hover text-ink-2" },
};

function Group({ title, tasks, today }: { title: keyof typeof GROUP_STYLE; tasks: WorkTask[]; today: string }) {
  if (tasks.length === 0) return null;
  const id = `work-${title.toLowerCase().replace(/\s+/g, "-")}`;
  const style = GROUP_STYLE[title];
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="flex items-center gap-3 text-body font-semibold text-ink">
        <span className={cn("inline-flex size-8 items-center justify-center rounded-control", style.tint)}>
          <Icon icon={style.icon} />
        </span>
        {title}
        <span className="rounded-full bg-hover px-2 text-label text-ink-2 tabular-nums">{tasks.length}</span>
      </h2>
      <ul className="stagger flex flex-col gap-2">
        {tasks.map((t, i) => (
          <TaskRow key={t.id} task={t} today={today} index={i} />
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
            <h2 id="work-mentions" className="flex items-center gap-3 text-body font-semibold text-ink">
              <span className="inline-flex size-8 items-center justify-center rounded-control bg-accent-soft text-accent-ink">
                <Icon icon={AtSign} />
              </span>
              Mentioned you
            </h2>
            <ul className="flex flex-col gap-2">
              {mentions.map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/projects/${m.projectKey}?task=${m.taskKey}`}
                    className="lift flex flex-col rounded-control border border-info-line bg-info-soft px-4 py-3"
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
    <PageLayout hero title="My Work" intro={welcomeLine(me.user.timezone)}>
      {content}
    </PageLayout>
  );
}
