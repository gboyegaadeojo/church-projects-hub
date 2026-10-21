import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  ChartColumn,
  CircleAlert,
  CircleCheck,
  CircleDot,
  FolderKanban,
  type LucideIcon,
  Timer,
  UserX,
  Users,
  WifiOff,
} from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { churchReports, PROJECT_HEALTH_LABELS, type ProjectHealth, REPORT_COPY, REPORT_RANGES } from "../../shared/reports";
import { PRIORITIES, PRIORITY_LABELS } from "../../shared/tasks";
import { BarList, LineChart, ReportCard } from "../components/reports/Charts";
import { ADMIN_CRUMBS, ProjectTile, useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { PRIORITY_TONE, VIVID_CLASSES, type Vivid } from "../components/tasks/tones";
import { Select } from "../components/ui/choices";
import { Field } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { useOnline } from "../lib/online";

// Church-wide reports (section 16, App Admin, v4.6): headline numbers, whether teams are keeping up week by week,
// each project's health, how late overdue work is, open work by priority, open work per person across all projects
// (RPT-2), and whether the hub is being used. Every number has words beside it (section 13). Not available offline.

const shortDate = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtWeek = (d: string) => shortDate.format(Date.parse(`${d}T00:00:00Z`));

function hours(h: number | null): string {
  if (h === null) return "—";
  if (h < 48) return `${h} ${h === 1 ? "hour" : "hours"}`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}

function ago(at: number | null): string {
  if (at === null) return "No activity yet";
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return `${Math.floor(days / 30)} ${days < 60 ? "month" : "months"} ago`;
}

const HEALTH_TONE: Record<ProjectHealth, Vivid> = { on_track: "green", at_risk: "red", quiet: "orange", archived: "grey" };
const HEALTH_ORDER: ProjectHealth[] = ["at_risk", "quiet", "on_track", "archived"];

export function ChurchReportsPage() {
  const me = useMe();
  const online = useOnline();
  const [params, setParams] = useSearchParams();
  const weeks = REPORT_RANGES.includes(Number(params.get("weeks")) as 12) ? Number(params.get("weeks")) : 12;
  const isAdmin = me.user.appRole === "admin";
  const reports = useQuery({
    queryKey: ["reports", "church", weeks],
    enabled: isAdmin && online,
    queryFn: async () => churchReports.parse(await api(`/api/reports/church?weeks=${weeks}`)),
  });
  const csv = (name: string) => `/api/reports/church/${name}.csv?weeks=${weeks}`;
  const r = reports.data;

  return (
    <PageLayout
      breadcrumbs={ADMIN_CRUMBS}
      title="Church-wide reports"
      wide
      actions={
        isAdmin &&
        online && (
          <div className="w-44">
            <Field label="Date range" filter className="[&>label]:sr-only">
              <Select options={REPORT_RANGES.map((w) => ({ value: String(w), label: `Last ${w} weeks` }))} value={String(weeks)} onValueChange={(v) => setParams({ weeks: v })} />
            </Field>
          </div>
        )
      }
    >
      {!isAdmin ? (
        <EmptyState icon={ChartColumn} title="Only app admins can see church-wide reports." />
      ) : !online ? (
        <EmptyState icon={WifiOff} title={REPORT_COPY.offline} />
      ) : reports.isError ? (
        <ErrorState title="We couldn't load the reports." description="Check your connection and try again." onRetry={() => void reports.refetch()} retrying={reports.isFetching} />
      ) : !r ? (
        <div aria-busy="true" aria-label="Loading reports" className="flex flex-col gap-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Kpi icon={FolderKanban} tone="blue" label="Active projects" value={r.kpis.activeProjects} />
            <Kpi icon={CircleDot} tone="indigo" label="Open tasks" value={r.kpis.open} />
            <Kpi icon={CircleAlert} tone="red" label="Overdue" value={r.kpis.overdue} hint={r.kpis.open ? `${Math.round((r.kpis.overdue / r.kpis.open) * 100)}% of open` : undefined} />
            <Kpi icon={UserX} tone="orange" label="Unassigned" value={r.kpis.unassigned} />
            <Kpi icon={CircleCheck} tone="green" label={`Completed, ${weeks} weeks`} value={r.kpis.completedInRange} hint={`${r.kpis.createdInRange} created`} />
            <Kpi icon={CalendarClock} tone="teal" label="Finished on time" value={r.kpis.onTimeRate === null ? "—" : `${r.kpis.onTimeRate}%`} hint="of tasks with a due date" />
            <Kpi icon={Timer} tone="purple" label="Median time to done" value={r.kpis.medianCycleDays === null ? "—" : `${r.kpis.medianCycleDays} d`} />
            <Kpi icon={Users} tone="pink" label="Active this week" value={r.kpis.activePeopleThisWeek} hint="people" />
          </dl>

          <div className="grid gap-4 lg:grid-cols-3">
            <ReportCard
              title="Created and completed"
              summary={(() => {
                const created = r.trend.reduce((n, w) => n + w.created, 0);
                const completed = r.trend.reduce((n, w) => n + w.completed, 0);
                return `${completed} completed and ${created} created in ${weeks} weeks: teams are ${completed >= created ? "keeping up" : "falling behind"}.`;
              })()}
              csv={csv("trend")}
              table={{ head: ["Week of", "Created", "Completed"], rows: r.trend.map((w) => [fmtWeek(w.weekStart), w.created, w.completed]) }}
              className="lg:col-span-2"
            >
              <LineChart
                labels={r.trend.map((w) => w.weekStart)}
                formatLabel={fmtWeek}
                series={[
                  { name: "Created", values: r.trend.map((w) => w.created) },
                  { name: "Completed", values: r.trend.map((w) => w.completed) },
                ]}
              />
            </ReportCard>
            <div className="flex flex-col gap-4">
              <ReportCard
                title="How late overdue work is"
                summary={r.kpis.overdue === 0 ? "Nothing is overdue." : `${r.aging.older} ${r.aging.older === 1 ? "task is" : "tasks are"} more than a month late.`}
                table={{ head: ["Late by", "Tasks"], rows: [["Up to a week", r.aging.week], ["8–30 days", r.aging.month], ["Over a month", r.aging.older]] }}
              >
                <BarList series={["Tasks"]} rows={[{ label: "Up to a week", values: [r.aging.week] }, { label: "8–30 days", values: [r.aging.month] }, { label: "Over a month", values: [r.aging.older] }]} />
              </ReportCard>
              <ReportCard title="Open work by priority" summary={`${r.priorities.urgent} urgent and ${r.priorities.high} high-priority tasks are open.`}>
                <PriorityMix counts={r.priorities} />
              </ReportCard>
            </div>
          </div>

          <ReportCard
            title="Project health"
            summary={`${r.overview.filter((p) => p.health === "at_risk").length} at risk, ${r.overview.filter((p) => p.health === "quiet").length} quiet, ${r.overview.filter((p) => p.health === "on_track").length} on track. At risk: over a fifth of open work overdue. Quiet: no task changes for 3 weeks.`}
            csv={csv("overview")}
          >
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[46rem] text-left text-secondary">
                <caption className="sr-only">Project health</caption>
                <thead>
                  <tr className="border-b border-line text-caption text-ink-2">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Project
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Health
                    </th>
                    <th scope="col" className="w-48 py-2 pr-4 font-medium">
                      Open work
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Overdue
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Created
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      Completed
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">
                      People
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Last activity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* What needs attention first: at risk, then quiet, then on track; archived last. */}
                  {[...r.overview].sort((a, b) => HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health)).map((p) => (
                    <tr key={p.id} className="border-b border-line last:border-0">
                      <td className="py-2 pr-4">
                        <Link to={`/projects/${p.key}/reports`} className="inline-flex min-h-6 items-center gap-2 font-medium text-ink underline-offset-2 hover:underline">
                          <ProjectTile project={p} size="sm" />
                          {p.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">
                        <span className={cn("inline-flex rounded-chip px-2 py-0.5 text-label font-semibold whitespace-nowrap text-on-vivid", VIVID_CLASSES[HEALTH_TONE[p.health]].bg)}>
                          {PROJECT_HEALTH_LABELS[p.health]}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <span className="flex items-center gap-2">
                          <span
                            className="flex h-2 w-24 overflow-hidden rounded-pill bg-hover"
                            role="img"
                            aria-label={`${p.todo} to do, ${p.inProgress} in progress`}
                          >
                            {p.open > 0 && (
                              <>
                                <span className="bg-line-strong" style={{ width: `${(p.todo / p.open) * 100}%` }} />
                                <span className="bg-vivid-orange" style={{ width: `${(p.inProgress / p.open) * 100}%` }} />
                              </>
                            )}
                          </span>
                          <span className="text-ink tabular-nums">{p.open}</span>
                        </span>
                      </td>
                      <td className={cn("py-2 pr-4 text-right tabular-nums", p.overdue > 0 ? "font-medium text-overdue-ink" : "text-ink")}>
                        {p.overdue}
                        {p.open > 0 && p.overdue > 0 && <span className="text-caption text-ink-2"> ({Math.round((p.overdue / p.open) * 100)}%)</span>}
                      </td>
                      <td className="py-2 pr-4 text-right text-ink tabular-nums">{p.createdInRange}</td>
                      <td className="py-2 pr-4 text-right text-ink tabular-nums">{p.completedInRange}</td>
                      <td className="py-2 pr-4 text-right text-ink tabular-nums">{p.members}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-ink-2">{ago(p.lastActivityAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ReportCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ReportCard
              title="Workload across projects"
              summary={
                r.workload.length === 0
                  ? "No one has open tasks."
                  : `Most open tasks: ${r.workload[0]!.person.name} with ${r.workload[0]!.open} across ${r.workload[0]!.projects} ${r.workload[0]!.projects === 1 ? "project" : "projects"}.`
              }
              csv={csv("workload")}
              table={{ head: ["Person", "Open", "Overdue", "Projects"], rows: r.workload.map((w) => [w.person.name, w.open, w.overdue, w.projects]) }}
            >
              {r.workload.length > 0 && <BarList series={["Open", "Overdue"]} rows={r.workload.slice(0, 15).map((w) => ({ label: w.person.name, values: [w.open, w.overdue] }))} />}
            </ReportCard>

            <ReportCard
              title="Access and adoption"
              summary={`People who signed in or changed a task or comment each week. ${r.adoption.pendingRequests} access ${r.adoption.pendingRequests === 1 ? "request is" : "requests are"} waiting.`}
              csv={csv("adoption")}
              table={{ head: ["Week of", "Active people"], rows: r.adoption.activeByWeek.map((w) => [fmtWeek(w.weekStart), w.people]) }}
            >
              <div className="flex flex-col gap-4">
                <dl className="grid grid-cols-2 gap-3">
                  <div className="rounded-control border border-line p-3">
                    <dt className="text-caption text-ink-2">Waiting requests</dt>
                    <dd className="text-title tabular-nums text-ink">{r.adoption.pendingRequests}</dd>
                  </div>
                  <div className="rounded-control border border-line p-3">
                    <dt className="text-caption text-ink-2">Average time to decide</dt>
                    <dd className="text-title tabular-nums text-ink">{hours(r.adoption.avgDecisionHours)}</dd>
                    <dd className="text-caption text-ink-2">{r.adoption.decided} decided in range</dd>
                  </div>
                </dl>
                <LineChart labels={r.adoption.activeByWeek.map((w) => w.weekStart)} formatLabel={fmtWeek} series={[{ name: "Active", values: r.adoption.activeByWeek.map((w) => w.people) }]} />
              </div>
            </ReportCard>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

function Kpi({ icon, tone, label, value, hint }: { icon: LucideIcon; tone: Vivid; label: string; value: number | string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line bg-card p-3 shadow-raised">
      <dt className="flex items-center gap-2 text-caption text-ink-2">
        <span aria-hidden="true" className={cn("inline-flex size-6 items-center justify-center rounded-chip text-on-vivid", VIVID_CLASSES[tone].bg)}>
          <Icon icon={icon} size="sm" />
        </span>
        {label}
      </dt>
      <dd className="text-large-title text-ink tabular-nums">{value}</dd>
      {hint && <dd className="text-caption text-ink-2">{hint}</dd>}
    </div>
  );
}

/** One bar split by priority, with each count in words underneath. */
function PriorityMix({ counts }: { counts: Record<(typeof PRIORITIES)[number], number> }) {
  const total = PRIORITIES.reduce((n, p) => n + counts[p], 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 overflow-hidden rounded-pill bg-hover" role="img" aria-label={PRIORITIES.map((p) => `${counts[p]} ${PRIORITY_LABELS[p].toLowerCase()}`).join(", ")}>
        {total > 0 && PRIORITIES.map((p) => <span key={p} className={VIVID_CLASSES[PRIORITY_TONE[p]].bg} style={{ width: `${(counts[p] / total) * 100}%` }} />)}
      </div>
      <ul className="grid grid-cols-2 gap-2 text-secondary">
        {PRIORITIES.map((p) => (
          <li key={p} className="flex items-center gap-2">
            <span aria-hidden="true" className={cn("size-2.5 rounded-full", VIVID_CLASSES[PRIORITY_TONE[p]].bg)} />
            <span className="text-ink">{PRIORITY_LABELS[p]}</span>
            <span className="ml-auto text-ink-2 tabular-nums">{counts[p]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
