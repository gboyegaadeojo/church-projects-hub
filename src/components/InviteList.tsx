import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, RotateCw, X } from "lucide-react";
import { useState } from "react";
import { type InviteRow, invitesResponse, MANAGE_CONFIRM, resendInviteResponse } from "../../shared/admin";
import type { MeResponse } from "../../shared/auth";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { EmptyState, ErrorState } from "./ui/States";
import { type Column, Table } from "./ui/Table";
import { toast } from "./ui/Toast";
import { api } from "../lib/api";

// Invite management (ADM-7, section 11.12): recipient, project, role, sent by, expiry and status, with
// Cancel for pending invites and Resend for expired ones ("Expired — resend?", section 2).

export const INVITES_KEY = ["invites"];
const FAILED = "That didn't go through. Check your connection and try again.";
const ROLE_LABELS: Record<InviteRow["role"], string> = { admin: "Project Admin", contributor: "Contributor", viewer: "Viewer" };

function StatusBadge({ status }: { status: InviteRow["status"] }) {
  if (status === "pending") return <Badge tone="info">Pending</Badge>;
  if (status === "used") return <Badge tone="success">Accepted</Badge>;
  if (status === "expired") return <Badge tone="warning">Expired — resend?</Badge>;
  return <Badge>Cancelled</Badge>;
}

export function InviteList({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const invites = useQuery({ queryKey: INVITES_KEY, queryFn: async () => invitesResponse.parse(await api("/api/invites")).invites });
  const [cancelling, setCancelling] = useState<InviteRow | null>(null);
  const [resending, setResending] = useState<number | null>(null);
  const dateFormat = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: me.user.timezone });

  async function resend(invite: InviteRow) {
    setResending(invite.id);
    try {
      resendInviteResponse.parse(await api(`/api/invites/${invite.id}/resend`, { method: "POST", csrfToken: me.csrfToken }));
      await queryClient.invalidateQueries({ queryKey: INVITES_KEY });
      toast({ variant: "success", title: `Invite sent again to ${invite.email}.` });
    } catch {
      toast({ variant: "error", title: FAILED });
    } finally {
      setResending(null);
    }
  }

  const columns: Column<InviteRow>[] = [
    { key: "email", header: "Recipient", cell: (i) => <span className="break-all">{i.email}</span> },
    { key: "project", header: "Project", cell: (i) => i.project.name },
    { key: "role", header: "Role", cell: (i) => ROLE_LABELS[i.role] },
    { key: "sentBy", header: "Sent by", cell: (i) => i.sentBy },
    { key: "expires", header: "Expires", numeric: true, cell: (i) => dateFormat.format(i.expiresAt) },
    { key: "status", header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
  ];

  return (
    <section className="flex flex-col gap-3" aria-labelledby="invites-heading">
      <h2 id="invites-heading" className="text-body font-semibold text-ink">
        Invites
      </h2>
      {invites.isError ? (
        <ErrorState title="We couldn't load invites." description="Check your connection and try again." onRetry={() => void invites.refetch()} retrying={invites.isFetching} />
      ) : (
        <Table
          caption="Invites"
          captionHidden
          columns={columns}
          rows={invites.data ?? []}
          getRowKey={(i) => String(i.id)}
          rowActions={(i) =>
            i.status === "pending" ? (
              <Button variant="ghost" icon={X} onClick={() => setCancelling(i)} aria-label={`Cancel invite for ${i.email}`}>
                Cancel
              </Button>
            ) : i.status === "expired" ? (
              <Button variant="secondary" icon={RotateCw} loading={resending === i.id} onClick={() => void resend(i)} aria-label={`Resend invite to ${i.email}`}>
                Resend
              </Button>
            ) : null
          }
          empty={<EmptyState icon={Mail} title="No invites in the last 90 days." />}
        />
      )}
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancel the invite for ${cancelling?.email ?? ""}?`}
        description="The link stops working straight away. You can send a new invite later."
        confirmLabel="Cancel invite"
        confirmIcon={X}
        confirmAction={MANAGE_CONFIRM.cancelInvite}
        successMessage="Invite cancelled."
        onConfirm={async (headers) => {
          await api(`/api/invites/${cancelling!.id}/cancel`, { method: "POST", csrfToken: me.csrfToken, headers });
          await queryClient.invalidateQueries({ queryKey: INVITES_KEY });
          setCancelling(null);
        }}
      />
    </section>
  );
}
