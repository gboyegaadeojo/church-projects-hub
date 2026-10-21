import { useQuery } from "@tanstack/react-query";
import { WifiOff } from "lucide-react";
import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { EMPTY_FILTER, filterFromSearch, filterToSearch, type TaskFilter } from "../../shared/filters";
import { projectResponse } from "../../shared/projects";
import { type ProjectReports, projectReports, REPORT_COPY, REPORT_RANGES } from "../../shared/reports";
import { PRIORITIES, PRIORITY_LABELS } from "../../shared/tasks";
import { BarList, LineChart, Progress, ReportCard, StackedBar } from "../components/reports/Charts";
import { ProjectTile, useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { ProjectTabs } from "../components/shell/ProjectTabs";
import { FilterBar } from "../components/tasks/FilterBar";
import { Select } from "../components/ui/choices";
import { Field } from "../components/ui/Field";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { api } from "../lib/api";
import { useOnline } from "../lib/online";
import { useBoard } from "../lib/tasks";

// Project reports (section 16, RPT-1 to RPT-4): range 4/12/26 weeks, filters assignee/label/priority, a text
// summary, chart, table view, "View tasks" drill-down and CSV for each. Not available offline.

const CATEGORY_LABELS = { todo: "To do", in_progress: "In progress", done: "Done" } as const;
const shortDate = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("en-CA", { month: "short", year: "numeric", timeZone: "UTC" });
const fmtWeek = (d: string) => shortDate.format(Date.parse(`${d}T00:00:00Z`));
const fmtMonth = (m: string) => monthName.format(Date.parse(`${m}-01T00:00:00Z`));

export function ProjectReportsPage() {
  const me = useMe();
  const online = useOnline();
  const { key = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const project = useQuery({
    queryKey: ["projects", "by-key", key.toUpperCase()],
    queryFn: async () => projectResponse.parse(await api(`/api/projects/by-key/${encodeURIComponent(key)}`)).project,
  });
  const board = useBoard(project.data?.id);
  const weeks = REPORT_RANGES.includes(Number(params.get("weeks")) as 12) ? Number(params.get("weeks")) : 12;
  const filter = useMemo(() => {
    const f = filterFromSearch(params);
    return { ...f, scopes: [] } satisfies TaskFilter;
  }, [params]);
  // The same query string drives the API, the CSV links and the drill-downs.
  const query = filterToSearch(filter, new URLSearchParams({ weeks: String(weeks) })).toString();
  const reports = useQuery({
    queryKey: ["reports", project.data?.id, query],
    enabled: !!project.data && online,
    queryFn: async () => projectReports.parse(await api(`/api/projects/${project.data!.id}/reports?${query}`)),
  });

  const filterQuery = filterToSearch(filter, new URLSearchParams()).toString();
  const drill = (extra: Record<string, string>) => `/projects/${key}?${new URLSearchParams({ view: "list", ...Object.fromEntries(new URLSearchParams(filterQuery)), ...extra })}`;
  const csv = (name: string) => (project.data ? `/api/projects/${project.data.id}/reports/${name}.csv?${query}` : undefined);

  return (
    <PageLayout
      title={project.data ? `${project.data.name} reports` : "Reports"}
      intro="Created vs completed and cycle time update every hour; everything else is live."
      breadcrumbs={[{ to: "/projects", label: "Projects" }, ...(project.data ? [{ to: `/projects/${project.data.key}`, label: project.data.name }] : [])]}
      leading={project.data && <ProjectTile project={project.data} size="lg" />}
    >
      <ProjectTabs projectKey={project.data?.key ?? key.toUpperCase()} active="reports" />
      {!online ? (
        <EmptyState icon={WifiOff} title={REPORT_COPY.offline} />
      ) : project.isError || reports.isError ? (
        <ErrorState title="We couldn't load the reports." description="Check your connection and try again." onRetry={() => void reports.refetch()} retrying={reports.isFetching} />
      ) : (
        <div className="flex flex-col gap-group">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-44">
              <Field label="Date range" filter>
                <Select
                  options={REPORT_RANGES.map((w) => ({ value: String(w), label: `Last ${w} weeks` }))}
                  value={String(weeks)}
                  onValueChange={(v) =>
                    setParams((p) => {
                      const next = new URLSearchParams(p);
                      next.set("weeks", v);
                      return next;
                    })
                  }
                />
              </Field>
            </div>
            {board.data && project.data && (
              <FilterBar
                reports
                projectId={project.data.id}
                filter={filter}
                onChange={(f) => setParams((p) => filterToSearch({ ...EMPTY_FILTER, ...f, scopes: [] }, p), { replace: true })}
                members={board.data.members}
                labels={board.data.labels}
                meId={me.user.id}
                csrfToken={me.csrfToken}
                canShare={false}
                canManageShared={false}
              />
            )}
          </div>
          {!reports.data ? (
            <div aria-busy="true" aria-label="Loading reports" className="grid gap-4 lg:grid-cols-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-56 w-full" />
              ))}
            </div>
          ) : (
            <Reports r={reports.data} drill={drill} csv={csv} />
          )}
        </div>
      )}
    </PageLayout>
  );
}

function Reports({ r, drill, csv }: { r: ProjectReports; drill: (extra: Record<string, string>) => string; csv: (name: string) => string | undefined }) {
  const byCategory = (["todo", "in_progress", "done"] as const).map((c) => ({
    category: c,
    count: r.status.filter((s) => s.category === c).reduce((n, s) => n + s.count, 0),
  }));
  const open = byCategory[0]!.count + byCategory[1]!.count;
  const overdue = r.atRisk.flatMap((g) => g.tasks).filter((t) => t.daysOverdue > 0).length;
  const dueSoon = r.atRisk.flatMap((g) => g.tasks).length - overdue;
  const created = r.throughput.reduce((n, w) => n + w.created, 0);
  const completed = r.throughput.reduce((n, w) => n + w.completed, 0);
  const latestCycle = [...r.cycleTime].reverse().find((m) => m.count > 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ReportCard
        title="Status overview"
        summary={`${open} open (${byCategory[0]!.count} to do, ${byCategory[1]!.count} in progress) and ${byCategory[2]!.count} done.`}
        viewTasks={drill({ category: "open" })}
        csv={csv("status")}
        table={{ head: ["Column", "Category", "Tasks"], rows: r.status.map((s) => [s.name, CATEGORY_LABELS[s.category], s.count]) }}
      >
        <StackedBar segments={byCategory.map((c) => ({ label: CATEGORY_LABELS[c.category], value: c.count, href: drill({ category: c.category }) }))} />
      </ReportCard>

      <ReportCard
        title="Overdue and due soon"
        summary={overdue + dueSoon === 0 ? "Nothing is overdue or due in the next 7 days." : `${overdue} overdue and ${dueSoon} due in the next 7 days.`}
        viewTasks={drill({ due: "soon" })}
        csv={csv("at-risk")}
      >
        {r.atRisk.length > 0 && (
          <div className="flex flex-col gap-3">
            {r.atRisk.map((g) => (
              <section key={g.assignee?.id ?? "none"} aria-label={g.assignee?.name ?? "Unassigned"}>
                <h3 className="text-caption font-semibold text-ink-2">{g.assignee?.name ?? "Unassigned"}</h3>
                <ul className="mt-1 flex flex-col gap-1">
                  {g.tasks.map((t) => (
                    <li key={t.id} className="flex items-baseline justify-between gap-3 text-secondary">
                      <span className="min-w-0 truncate text-ink">
                        <span className="tabular-nums text-ink-2">{t.key}</span> {t.title}
                      </span>
                      <span className={t.daysOverdue > 0 ? "shrink-0 font-medium text-overdue-ink" : "shrink-0 text-ink-2"}>
                        {t.daysOverdue > 0 ? `${t.daysOverdue} ${t.daysOverdue === 1 ? "day" : "days"} overdue` : t.daysOverdue === 0 ? "Due today" : `Due in ${-t.daysOverdue} ${t.daysOverdue === -1 ? "day" : "days"}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </ReportCard>

      <ReportCard
        title="Created vs completed"
        summary={`${created} created and ${completed} completed in the last ${r.range.weeks} weeks${created > completed ? " — more is coming in than going out." : "."}`}
        csv={csv("throughput")}
        table={{ head: ["Week of", "Created", "Completed"], rows: r.throughput.map((w) => [fmtWeek(w.weekStart), w.created, w.completed]) }}
        className="lg:col-span-2"
      >
        <LineChart
          labels={r.throughput.map((w) => w.weekStart)}
          formatLabel={fmtWeek}
          series={[
            { name: "Created", values: r.throughput.map((w) => w.created) },
            { name: "Completed", values: r.throughput.map((w) => w.completed) },
          ]}
        />
      </ReportCard>

      {r.workload && (
        <ReportCard
          title="Workload"
          summary={r.workload.length === 0 ? "No open tasks." : `Most open tasks: ${r.workload[0]!.assignee?.name ?? "Unassigned"} with ${r.workload[0]!.open}.`}
          csv={csv("workload")}
          table={{ head: ["Person", "Open", "Overdue"], rows: r.workload.map((w) => [w.assignee?.name ?? "Unassigned", w.open, w.overdue]) }}
        >
          <BarList
            series={["Open", "Overdue"]}
            rows={r.workload.map((w) => ({ label: w.assignee?.name ?? "Unassigned", values: [w.open, w.overdue], href: drill({ category: "open", assignee: w.assignee ? String(w.assignee.id) : "none" }) }))}
          />
        </ReportCard>
      )}

      <ReportCard
        title="Cycle time"
        summary={latestCycle ? `In ${fmtMonth(latestCycle.month)}, half of finished tasks took ${latestCycle.medianDays} days or less from In Progress to Done; 85% took ${latestCycle.p85Days} days or less.` : "No tasks went from In Progress to Done in this range yet."}
        csv={csv("cycle-time")}
        table={{ head: ["Month", "Tasks finished", "Median (days)", "85th percentile (days)"], rows: r.cycleTime.map((m) => [fmtMonth(m.month), m.count, m.medianDays ?? "—", m.p85Days ?? "—"]) }}
      >
        {latestCycle && (
          <BarList
            series={["Median days", "85th percentile days"]}
            rows={r.cycleTime.filter((m) => m.count > 0).map((m) => ({ label: fmtMonth(m.month), values: [m.medianDays ?? 0, m.p85Days ?? 0] }))}
          />
        )}
      </ReportCard>

      <ReportCard
        title="Labels"
        summary={r.labels.length === 0 ? "This project has no labels yet." : `Open tasks and tasks completed in the last ${r.range.weeks} weeks, per label.`}
        csv={csv("labels")}
        table={{ head: ["Label", "Open", "Completed"], rows: r.labels.map((l) => [l.name, l.open, l.completed]) }}
      >
        {r.labels.length > 0 && <BarList series={["Open", "Completed"]} rows={r.labels.map((l) => ({ label: l.name, values: [l.open, l.completed], href: drill({ label: String(l.id) }) }))} />}
      </ReportCard>

      <ReportCard
        title="Components"
        summary={r.components.length === 0 ? "This project has no components yet." : `Open tasks and tasks completed in the last ${r.range.weeks} weeks, per component.`}
        csv={csv("components")}
        table={{ head: ["Component", "Open", "Completed"], rows: r.components.map((c) => [c.name, c.open, c.completed]) }}
      >
        {r.components.length > 0 && <BarList series={["Open", "Completed"]} rows={r.components.map((c) => ({ label: c.name, values: [c.open, c.completed], href: drill({ component: String(c.id) }) }))} />}
      </ReportCard>

      <ReportCard
        title="Milestone progress"
        summary={r.milestones.length === 0 ? "No upcoming milestones." : `${r.milestones.length} upcoming ${r.milestones.length === 1 ? "milestone" : "milestones"}.`}
        csv={csv("milestones")}
        className="lg:col-span-2"
      >
        {r.milestones.length > 0 && (
          <ul className="flex flex-col gap-4">
            {r.milestones.map((m) => (
              <li key={m.id} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link to={drill({ milestone: String(m.id) })} className="inline-flex min-h-6 items-center text-secondary font-medium text-ink underline-offset-2 hover:underline">
                    {m.name}
                  </Link>
                  <span className="text-caption tabular-nums text-ink-2">
                    {m.done} of {m.total} done{m.targetDate ? ` · target ${fmtWeek(m.targetDate)}` : ""}
                  </span>
                </div>
                <Progress value={m.done} max={m.total} label={`${m.name} progress`} />
                <p className="text-caption text-ink-2">
                  Open by priority: {PRIORITIES.map((p) => `${PRIORITY_LABELS[p]} ${m.openByPriority[p] ?? 0}`).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </ReportCard>
    </div>
  );
}
