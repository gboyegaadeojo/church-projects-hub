import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Gauge, OctagonAlert, RefreshCw } from "lucide-react";
import { FREE_LIMITS, USAGE_WARN_AT, type UsageResponse, usageResponse } from "../../shared/admin";
import { AdminTabs } from "../components/shell/AdminTabs";
import { useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { api } from "../lib/api";
import { cn } from "../lib/cn";

// The usage panel (ADM-4, ADM-5, section 11.12): today and this month against the free-tier limits, with a
// warning banner at 80% and a critical one at 100% that says which limit was hit and when. Status is never
// shown by colour alone: each level has an icon and words. Loaded on demand — no polling (section 5).

const number = new Intl.NumberFormat("en-CA");

type Level = "ok" | "warning" | "critical";
const levelOf = (used: number, limit: number): Level => (used >= limit ? "critical" : used >= limit * USAGE_WARN_AT ? "warning" : "ok");

const LEVEL = {
  ok: { icon: CheckCircle2, word: "Within limit", text: "text-success-ink", bar: "bg-accent" },
  warning: { icon: AlertTriangle, word: "Over 80%", text: "text-warning-ink", bar: "bg-warning-ink" },
  critical: { icon: OctagonAlert, word: "Limit reached", text: "text-danger-ink", bar: "bg-danger" },
} as const;

function Meter({ m, timezone }: { m: UsageResponse["metrics"][number]; timezone: string }) {
  const limit = FREE_LIMITS[m.metric];
  const label = limit.label;
  if (m.today === null) {
    return (
      <li className="flex flex-col gap-2 rounded-card border border-line bg-card p-4">
        <span className="text-secondary font-medium text-ink">{label}</span>
        <span className="text-secondary text-ink-2">Not available until Cloudflare analytics is connected.</span>
      </li>
    );
  }
  const level = levelOf(m.today, limit.daily);
  const share = Math.min(1, m.today / limit.daily);
  const style = LEVEL[level];
  const time = new Intl.DateTimeFormat("en-CA", { timeStyle: "short", timeZone: timezone });
  return (
    <li className="flex flex-col gap-3 rounded-card border border-line bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span id={`meter-${m.metric}`} className="text-secondary font-medium text-ink">
          {label} today
        </span>
        <span className={cn("flex items-center gap-1 text-caption font-medium", style.text)}>
          <Icon icon={style.icon} size="sm" />
          {style.word}
        </span>
      </div>
      <p className="text-title tabular-nums text-ink">
        {number.format(m.today)} <span className="text-secondary text-ink-2">of {number.format(limit.daily)}</span>
      </p>
      <div
        role="meter"
        aria-labelledby={`meter-${m.metric}`}
        aria-valuemin={0}
        aria-valuemax={limit.daily}
        aria-valuenow={m.today}
        aria-valuetext={`${number.format(m.today)} of ${number.format(limit.daily)}, ${Math.round((m.today / limit.daily) * 100)}%`}
        className="h-2 overflow-hidden rounded-full bg-line"
      >
        <div className={cn("h-full rounded-full", style.bar)} style={{ width: `${share * 100}%` }} />
      </div>
      <p className="text-caption text-ink-2">
        This month: {m.month === null ? "—" : number.format(m.month)}
        {limit.monthly ? ` of ${number.format(limit.monthly)}` : ""}
        {m.limitReachedAt && ` · Limit reached at ${time.format(m.limitReachedAt)}`}
      </p>
    </li>
  );
}

export function AdminUsagePage() {
  const me = useMe();
  const usage = useQuery({
    queryKey: ["admin", "usage"],
    enabled: me.user.appRole === "admin",
    queryFn: async () => usageResponse.parse(await api("/api/admin/usage")),
  });
  const data = usage.data;
  const levels = (data?.metrics ?? []).filter((m) => m.today !== null).map((m) => ({ m, level: levelOf(m.today!, FREE_LIMITS[m.metric].daily) }));
  const critical = levels.filter((l) => l.level === "critical");
  const warning = levels.filter((l) => l.level === "warning");

  return (
    <PageLayout
      title="Usage"
      intro="Free-tier use for the whole Cloudflare account (shared with the checklist app). Limits reset at midnight UTC."
      actions={
        me.user.appRole === "admin" && (
          <Button variant="secondary" icon={RefreshCw} loading={usage.isFetching} onClick={() => void usage.refetch()}>
            Refresh
          </Button>
        )
      }
    >
      <AdminTabs me={me} />
      {me.user.appRole !== "admin" ? (
        <EmptyState icon={Gauge} title="Only app admins can see usage." />
      ) : usage.isError ? (
        <ErrorState title="We couldn't load usage." description="Check your connection and try again." onRetry={() => void usage.refetch()} retrying={usage.isFetching} />
      ) : !data ? (
        <div aria-busy="true" aria-label="Loading usage" className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {critical.length > 0 && (
            <div role="alert" className="flex gap-3 rounded-card border border-danger-line bg-danger-soft p-4 text-secondary text-danger-ink">
              <Icon icon={OctagonAlert} />
              <p>
                <strong className="font-semibold">Limit reached:</strong> {critical.map((c) => FREE_LIMITS[c.m.metric].label).join(", ")}.{" "}
                {critical.some((c) => c.m.metric === "emails")
                  ? "Instant emails are going into tomorrow's digest instead."
                  : "Parts of the hub may stop working until the limit resets at midnight UTC."}
              </p>
            </div>
          )}
          {critical.length === 0 && warning.length > 0 && (
            <div role="status" className="flex gap-3 rounded-card border border-warning-line bg-warning-soft p-4 text-secondary text-warning-ink">
              <Icon icon={AlertTriangle} />
              <p>
                <strong className="font-semibold">Over 80% today:</strong> {warning.map((w) => FREE_LIMITS[w.m.metric].label).join(", ")}. App Admins were emailed.
              </p>
            </div>
          )}
          {!data.analyticsConnected && (
            <p className="rounded-card border border-line bg-card p-4 text-secondary text-ink-2">
              Worker and database numbers need Cloudflare analytics. Add the <code>CF_ACCOUNT_ID</code> and <code>CF_ANALYTICS_TOKEN</code> secrets to see them.
            </p>
          )}
          {data.analyticsError && (
            <p role="status" className="rounded-card border border-warning-line bg-warning-soft p-4 text-secondary text-warning-ink">
              Cloudflare analytics didn't answer just now. Try Refresh in a minute.
            </p>
          )}
          <ul className="grid gap-4 sm:grid-cols-2">
            {data.metrics.map((m) => (
              <Meter key={m.metric} m={m} timezone={me.user.timezone} />
            ))}
          </ul>
          <p className="text-caption text-ink-2">
            {data.databaseBytes !== null && `Database size: ${(data.databaseBytes / 1_000_000).toFixed(1)} MB of 5,000 MB. `}
            Failed emails this month: {data.failedEmails}.
          </p>
        </div>
      )}
    </PageLayout>
  );
}
