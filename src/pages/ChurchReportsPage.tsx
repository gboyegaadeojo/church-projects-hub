import { useQuery } from "@tanstack/react-query";
import { ChartColumn, WifiOff } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { churchReports, REPORT_COPY, REPORT_RANGES } from "../../shared/reports";
import { BarList, LineChart, ReportCard } from "../components/reports/Charts";
import { AdminTabs } from "../components/shell/AdminTabs";
import { useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Badge } from "../components/ui/Badge";
import { Select } from "../components/ui/choices";
import { Field } from "../components/ui/Field";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { api } from "../lib/api";
import { useOnline } from "../lib/online";

// Church-wide reports (section 16, App Admin): how every team is doing, open work per person across all
// projects (RPT-2), and whether the hub is being used. Not available offline.

const shortDate = new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtWeek = (d: string) => shortDate.format(Date.parse(`${d}T00:00:00Z`));

function hours(h: number | null): string {
  if (h === null) return "—";
  if (h < 48) return `${h} ${h === 1 ? "hour" : "hours"}`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}

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
    <PageLayout title="Church-wide reports">
      <AdminTabs me={me} />
      {!isAdmin ? (
        <EmptyState icon={ChartColumn} title="Only app admins can see church-wide reports." />
      ) : !online ? (
        <EmptyState icon={WifiOff} title={REPORT_COPY.offline} />
      ) : reports.isError ? (
        <ErrorState title="We couldn't load the reports." description="Check your connection and try again." onRetry={() => void reports.refetch()} retrying={reports.isFetching} />
      ) : (
        <div className="flex flex-col gap-group">
          <div className="sm:w-44">
            <Field label="Date range" filter>
              <Select
                options={REPORT_RANGES.map((w) => ({ value: String(w), label: `Last ${w} weeks` }))}
                value={String(weeks)}
                onValueChange={(v) => setParams({ weeks: v })}
              />
            </Field>
          </div>
          {!r ? (
            <div aria-busy="true" aria-label="Loading reports" className="flex flex-col gap-4">
              <Skeleton className="h-48 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <ReportCard
                title="All projects"
                summary={`${r.overview.filter((p) => !p.archived).length} active projects, ${r.overview.reduce((n, p) => n + p.open, 0)} open tasks, ${r.overview.reduce((n, p) => n + p.overdue, 0)} overdue.`}
                csv={csv("overview")}
                className="lg:col-span-2"
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-secondary">
                    <caption className="sr-only">All projects</caption>
                    <thead>
                      <tr className="border-b border-line text-caption text-ink-2">
                        <th scope="col" className="py-2 pr-4 font-medium">
                          Project
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">
                          Open
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">
                          Overdue
                        </th>
                        <th scope="col" className="py-2 pr-4 text-right font-medium">
                          Completed this month
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.overview.map((p) => (
                        <tr key={p.id} className="border-b border-line last:border-0">
                          <td className="py-2 pr-4">
                            <Link to={`/projects/${p.key}/reports`} className="font-medium text-ink underline-offset-2 hover:underline">
                              {p.name}
                            </Link>{" "}
                            {p.archived && <Badge>Archived</Badge>}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-ink">{p.open}</td>
                          <td className={p.overdue > 0 ? "py-2 pr-4 text-right font-medium tabular-nums text-overdue-ink" : "py-2 pr-4 text-right tabular-nums text-ink"}>{p.overdue}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-ink">{p.completedThisMonth}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ReportCard>

              <ReportCard
                title="Workload across projects"
                summary={r.workload.length === 0 ? "No one has open tasks." : `Most open tasks: ${r.workload[0]!.person.name} with ${r.workload[0]!.open} across ${r.workload[0]!.projects} ${r.workload[0]!.projects === 1 ? "project" : "projects"}.`}
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
          )}
        </div>
      )}
    </PageLayout>
  );
}

