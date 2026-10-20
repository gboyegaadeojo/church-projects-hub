import { useInfiniteQuery } from "@tanstack/react-query";
import { Download, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { AUDIT_EXPORT_CAP, type AuditEntry, auditResponse } from "../../shared/admin";
import { AdminTabs } from "../components/shell/AdminTabs";
import { useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Button, buttonClasses } from "../components/ui/Button";
import { Select } from "../components/ui/choices";
import { Field } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { DateInput, TextInput } from "../components/ui/inputs";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { type Column, Table } from "../components/ui/Table";
import { api } from "../lib/api";

// The audit log (ADM-3, section 11.12): append-only (nothing here edits or deletes), searchable by actor,
// action type and date range, and exportable to CSV with the same filters (up to 5,000 rows).

/** Epoch ms of local midnight for a YYYY-MM-DD in the viewer's browser; good enough for a date filter. */
function dayStart(date: string, plusDays = 0): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  return String(new Date(y!, m! - 1, d! + plusDays).getTime());
}

function describeDetail(e: AuditEntry): string {
  return Object.entries(e.detail)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export function AdminAuditPage() {
  const me = useMe();
  const [actorTyped, setActorTyped] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setActor(actorTyped.trim()), 300);
    return () => clearTimeout(t);
  }, [actorTyped]);

  const params = new URLSearchParams();
  if (actor) params.set("actor", actor);
  if (action !== "all") params.set("action", action);
  if (from) params.set("from", dayStart(from));
  // "To" includes the whole day.
  if (to) params.set("to", dayStart(to, 1));
  const query = params.toString();

  const log = useInfiniteQuery({
    queryKey: ["admin", "audit", query],
    enabled: me.user.appRole === "admin",
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }) => auditResponse.parse(await api(`/api/admin/audit?${query}${pageParam ? `&before=${pageParam}` : ""}`)),
    getNextPageParam: (last) => last.nextBefore,
  });
  const entries = log.data?.pages.flatMap((p) => p.entries) ?? [];
  const actions = log.data?.pages[0]?.actions ?? [];
  const when = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: me.user.timezone });

  const columns: Column<AuditEntry>[] = [
    { key: "at", header: "When", cell: (e) => <time dateTime={new Date(e.at).toISOString()}>{when.format(e.at)}</time> },
    { key: "action", header: "Action", cell: (e) => <code className="text-caption">{e.action}</code> },
    { key: "actor", header: "Who", cell: (e) => e.actor?.name ?? "System" },
    { key: "target", header: "Target", cell: (e) => `${e.targetType} ${e.targetId}` },
    { key: "detail", header: "Details", cell: (e) => <span className="break-words text-caption text-ink-2">{describeDetail(e)}</span> },
  ];

  return (
    <PageLayout
      title="Audit log"
      intro="Every sign-in event, access decision, role change and deletion, kept for a year."
      actions={
        me.user.appRole === "admin" && (
          <a href={`/api/admin/audit.csv?${query}`} className={buttonClasses("secondary")} download>
            <Icon icon={Download} />
            Export CSV
          </a>
        )
      }
    >
      <AdminTabs me={me} />
      {me.user.appRole !== "admin" ? (
        <EmptyState icon={ScrollText} title="Only app admins can read the audit log." />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Who (name or email)">
              <TextInput type="search" value={actorTyped} onChange={(e) => setActorTyped(e.target.value)} />
            </Field>
            <Field label="Action">
              <Select options={[{ value: "all", label: "All actions" }, ...actions.map((a) => ({ value: a, label: a }))]} value={action} onValueChange={setAction} />
            </Field>
            <Field label="From">
              <DateInput value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <DateInput value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <p className="text-caption text-ink-2">The export uses these filters and includes up to {AUDIT_EXPORT_CAP.toLocaleString("en-CA")} rows, newest first.</p>
          {log.isError ? (
            <ErrorState title="We couldn't load the audit log." description="Check your connection and try again." onRetry={() => void log.refetch()} retrying={log.isFetching} />
          ) : log.isPending ? (
            <div aria-busy="true" aria-label="Loading the audit log" className="flex flex-col gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <>
              <Table
                caption="Audit log"
                captionHidden
                columns={columns}
                rows={entries}
                getRowKey={(e) => String(e.id)}
                empty={<EmptyState icon={ScrollText} title="Nothing matches these filters." />}
              />
              {log.hasNextPage && (
                <div>
                  <Button variant="secondary" loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
                    Show older entries
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </PageLayout>
  );
}
