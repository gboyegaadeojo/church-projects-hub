import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ShieldX, Trash2, UserX, X } from "lucide-react";
import { useState } from "react";
import {
  ADMIN_COPY,
  ADMIN_ERRORS,
  DELETION_CONFIRM,
  type DeletionRequestRow,
  deletionsResponse,
  type RetentionResponse,
  retentionResponse,
} from "../../shared/admin";
import { AdminTabs } from "../components/shell/AdminTabs";
import { useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { EmptyState, ErrorState } from "../components/ui/States";
import { type Column, Table } from "../components/ui/Table";
import { toast } from "../components/ui/Toast";
import { api, ApiError } from "../lib/api";

// Data deletion requests (ADM-6) and the "Eligible for deletion" queue (ADM-8), section 11.12. Approving a
// request and purging are high impact: type the email or project key (section 11.14). Nothing is automatic.

const FAILED = "That didn't go through. Check your connection and try again.";
type Purge = { kind: "project"; item: RetentionResponse["projects"][number] } | { kind: "user"; item: RetentionResponse["users"][number] };

function StatusBadge({ status }: { status: DeletionRequestRow["status"] }) {
  if (status === "pending") return <Badge tone="info">Waiting</Badge>;
  if (status === "rejected") return <Badge>Declined</Badge>;
  return <Badge tone="success">Deleted</Badge>;
}

export function AdminDeletionsPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const isAdmin = me.user.appRole === "admin";
  const requests = useQuery({ queryKey: ["admin", "deletions"], enabled: isAdmin, queryFn: async () => deletionsResponse.parse(await api("/api/admin/deletions")).requests });
  const retention = useQuery({ queryKey: ["admin", "retention"], enabled: isAdmin, queryFn: async () => retentionResponse.parse(await api("/api/admin/retention")) });
  const [approving, setApproving] = useState<DeletionRequestRow | null>(null);
  const [purging, setPurging] = useState<Purge | null>(null);
  const date = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: me.user.timezone });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });

  async function reject(r: DeletionRequestRow) {
    try {
      await api(`/api/admin/deletions/${r.id}/reject`, { method: "POST", csrfToken: me.csrfToken });
      await refresh();
      toast({ variant: "success", title: "Request declined." });
    } catch {
      toast({ variant: "error", title: FAILED });
    }
  }

  const requestColumns: Column<DeletionRequestRow>[] = [
    {
      key: "person",
      header: "Person",
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-medium text-ink">{r.user.name}</span>
          <span className="break-all text-caption text-ink-2">{r.user.email}</span>
        </span>
      ),
    },
    { key: "asked", header: "Asked", numeric: true, cell: (r) => date.format(r.requestedAt) },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "decided", header: "Decided by", cell: (r) => (r.decidedBy ? `${r.decidedBy}, ${date.format(r.decidedAt!)}` : "—") },
  ];

  if (!isAdmin) {
    return (
      <PageLayout title="Data deletion">
        <AdminTabs me={me} />
        <EmptyState icon={ShieldX} title="Only app admins can manage data deletion." />
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Data deletion" intro="Nothing here is deleted automatically. Review each request and each item, then confirm.">
      <AdminTabs me={me} />
      <section aria-labelledby="requests-heading" className="flex flex-col gap-3">
        <h2 id="requests-heading" className="text-body font-semibold text-ink">
          Deletion requests
        </h2>
        <p className="text-secondary text-ink-2">Aim to decide within 30 days of the request.</p>
        {requests.isError ? (
          <ErrorState title="We couldn't load requests." description="Check your connection and try again." onRetry={() => void requests.refetch()} retrying={requests.isFetching} />
        ) : (
          <Table
            caption="Deletion requests"
            captionHidden
            columns={requestColumns}
            rows={requests.data ?? []}
            getRowKey={(r) => String(r.id)}
            rowActions={(r) =>
              r.status === "pending" && r.user.id !== me.user.id ? (
                <span className="flex flex-wrap justify-end gap-2">
                  <Button variant="destructive" icon={Check} onClick={() => setApproving(r)} aria-label={`Approve deletion for ${r.user.name}`}>
                    Approve
                  </Button>
                  <Button variant="secondary" icon={X} onClick={() => void reject(r)} aria-label={`Decline deletion for ${r.user.name}`}>
                    Decline
                  </Button>
                </span>
              ) : null
            }
            empty={<EmptyState icon={UserX} title="No deletion requests." />}
          />
        )}
      </section>

      <section aria-labelledby="retention-heading" className="flex flex-col gap-3">
        <h2 id="retention-heading" className="text-body font-semibold text-ink">
          Eligible for deletion
        </h2>
        <p className="text-secondary text-ink-2">Projects archived and people suspended more than 6 months ago.</p>
        {retention.isError ? (
          <ErrorState title="We couldn't load the queue." description="Check your connection and try again." onRetry={() => void retention.refetch()} retrying={retention.isFetching} />
        ) : retention.data && retention.data.projects.length + retention.data.users.length === 0 ? (
          <EmptyState icon={Trash2} title="Nothing is eligible for deletion." />
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
            {retention.data?.projects.map((p) => (
              <li key={`p${p.id}`} className="flex flex-wrap items-center gap-3 p-4">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium text-ink">
                    Project {p.name} ({p.key})
                  </span>
                  <span className="text-caption text-ink-2">
                    Archived {date.format(p.archivedAt)} · {p.tasks} {p.tasks === 1 ? "task" : "tasks"}
                  </span>
                </span>
                <Button variant="destructive" icon={Trash2} onClick={() => setPurging({ kind: "project", item: p })} aria-label={`Purge project ${p.name}`}>
                  Purge
                </Button>
              </li>
            ))}
            {retention.data?.users.map((u) => (
              <li key={`u${u.id}`} className="flex flex-wrap items-center gap-3 p-4">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium text-ink">{u.name}</span>
                  <span className="break-all text-caption text-ink-2">
                    {u.email} · suspended {date.format(u.suspendedAt)}
                  </span>
                </span>
                <Button variant="destructive" icon={Trash2} onClick={() => setPurging({ kind: "user", item: u })} aria-label={`Purge ${u.name}`}>
                  Purge
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={approving !== null}
        onOpenChange={(o) => !o && setApproving(null)}
        title={`Delete ${approving?.user.name ?? "this person"}'s data?`}
        description="Their name, email and picture become “Deleted User” and a number, and they're signed out for good. Their tasks and comments stay. This can't be undone."
        confirmLabel="Delete data"
        confirmIcon={Trash2}
        confirmAction={DELETION_CONFIRM.approve}
        confirmText={approving?.user.email}
        successMessage="Data deleted."
        onConfirm={async (headers) => {
          try {
            await api(`/api/admin/deletions/${approving!.id}/approve`, { method: "POST", csrfToken: me.csrfToken, headers });
          } catch (err) {
            if (err instanceof ApiError && (err.code === ADMIN_ERRORS.lastAdmin || err.code === ADMIN_ERRORS.self)) {
              toast({ variant: "error", title: err.code === ADMIN_ERRORS.self ? ADMIN_COPY.self : ADMIN_COPY.lastAdmin });
              setApproving(null);
              return;
            }
            throw err;
          }
          await refresh();
          setApproving(null);
        }}
      />
      <ConfirmDialog
        open={purging !== null}
        onOpenChange={(o) => !o && setPurging(null)}
        title={purging?.kind === "project" ? `Purge project ${purging.item.name}?` : `Purge ${purging?.item.name ?? "this person"}?`}
        description={
          purging?.kind === "project"
            ? "Its tasks, comments, files and settings are deleted for good. This can't be undone."
            : "Their name, email and picture become “Deleted User” and a number. Their tasks and comments stay. This can't be undone."
        }
        confirmLabel="Purge"
        confirmIcon={Trash2}
        confirmAction={DELETION_CONFIRM.purge}
        confirmText={purging?.kind === "project" ? purging.item.key : purging?.item.email}
        successMessage="Purged."
        onConfirm={async (headers) => {
          await api(`/api/admin/retention/${purging!.kind === "project" ? "projects" : "users"}/${purging!.item.id}/purge`, { method: "POST", csrfToken: me.csrfToken, headers });
          await refresh();
          setPurging(null);
        }}
      />
    </PageLayout>
  );
}
