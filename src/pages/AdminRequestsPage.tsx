import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Inbox, UserPlus, X } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import {
  type AccessQueueResponse,
  accessQueueResponse,
  ACCESS_ERRORS,
  CONFIRM_ACTIONS,
  createInviteResponse,
  DEFAULT_APPROVAL_ROLE,
  PROJECT_ROLE_LABELS,
  PROJECT_ROLE_VALUES,
  type ProjectRole,
  type QueueRequest,
  REASON_MAX,
} from "../../shared/access";
import type { MeResponse } from "../../shared/auth";
import { AdminTabs } from "../components/shell/AdminTabs";
import { useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Dialog, DialogContent } from "../components/ui/Dialog";
import { Field } from "../components/ui/Field";
import { RadioGroup, Select } from "../components/ui/choices";
import { Textarea, TextInput } from "../components/ui/inputs";
import { EmptyState, ErrorState } from "../components/ui/States";
import { type Column, Table } from "../components/ui/Table";
import { toast } from "../components/ui/Toast";
import { api, ApiError } from "../lib/api";

// Access request queue and invites (section 7, ADM-1 subset, AUTH-9). App Admins see every request;
// Project Admins their own projects. The full admin area (ADM-1 to ADM-8) is Stage 6.

const QUEUE_KEY = ["admin", "access-queue"] as const;
const FAILED = "That didn't go through. Check your connection and try again.";
const ROLE_OPTIONS = PROJECT_ROLE_VALUES.map((value) => ({ value, label: PROJECT_ROLE_LABELS[value] }));
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function AdminRequestsPage() {
  const me = useMe();
  const queue = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: async () => accessQueueResponse.parse(await api("/api/admin/access-queue")),
    retry: (count, err) => !(err instanceof ApiError && err.status === 403) && count < 2,
  });
  const [approving, setApproving] = useState<QueueRequest | null>(null);
  const [denying, setDenying] = useState<QueueRequest | null>(null);

  if (queue.error instanceof ApiError && queue.error.status === 403) {
    return (
      <Page me={me}>
        <EmptyState icon={Inbox} title="Only project and app admins can review access requests." />
      </Page>
    );
  }

  const columns: Column<QueueRequest>[] = [
    {
      key: "person",
      header: "Person",
      cell: (r) => (
        <span className="flex flex-col">
          <span className="font-medium text-ink">{r.requester.name}</span>
          <span className="text-secondary text-ink-2">{r.requester.email}</span>
        </span>
      ),
    },
    {
      key: "project",
      header: "Project",
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <span>{r.project.name}</span>
          {r.noProjectAdmin && <Badge tone="info">No project admin</Badge>}
        </span>
      ),
    },
    { key: "note", header: "Note", cell: (r) => r.note || <span className="text-ink-2">No note</span> },
    { key: "requested", header: "Requested", numeric: true, cell: (r) => dateFormat.format(r.createdAt) },
  ];

  return (
    <Page me={me}>
      {queue.isError ? (
        <ErrorState title="We couldn't load access requests." description="Check your connection and try again." onRetry={() => void queue.refetch()} />
      ) : (
        <Table
          caption="Access requests"
          columns={columns}
          rows={queue.data?.requests ?? []}
          getRowKey={(r) => String(r.id)}
          rowActions={(r) => (
            <span className="inline-flex gap-2">
              <Button variant="secondary" icon={Check} onClick={() => setApproving(r)}>
                Approve
              </Button>
              <Button variant="ghost" icon={X} onClick={() => setDenying(r)}>
                Deny
              </Button>
            </span>
          )}
          empty={<EmptyState icon={Inbox} title="No requests waiting." />}
        />
      )}

      {queue.data && queue.data.invitableProjects.length > 0 && (
        <InviteForm me={me} projects={queue.data.invitableProjects} />
      )}

      <ApproveDialog me={me} request={approving} onClose={() => setApproving(null)} />
      <DenyDialog me={me} request={denying} onClose={() => setDenying(null)} />
    </Page>
  );
}

function Page({ me, children }: { me: MeResponse; children: ReactNode }) {
  return (
    <PageLayout title="Access requests">
      <AdminTabs me={me} />
      {children}
    </PageLayout>
  );
}

/** After a decision the request leaves the queue; a 409 means someone else already decided it. */
function useDecisionDone() {
  const queryClient = useQueryClient();
  return {
    refresh: () => queryClient.invalidateQueries({ queryKey: QUEUE_KEY }),
    alreadyDecided: (err: unknown) => err instanceof ApiError && err.code === ACCESS_ERRORS.alreadyDecided,
  };
}

function ApproveDialog({ me, request, onClose }: { me: MeResponse; request: QueueRequest | null; onClose: () => void }) {
  const [role, setRole] = useState<ProjectRole>(DEFAULT_APPROVAL_ROLE);
  const { refresh, alreadyDecided } = useDecisionDone();
  const approve = useMutation({
    mutationFn: (r: QueueRequest) =>
      api(`/api/access-requests/${r.id}/approve`, { body: { role }, csrfToken: me.csrfToken }),
    onSuccess: async () => {
      toast({ variant: "success", title: "Request approved." });
      await refresh();
      onClose();
    },
    onError: async (err) => {
      if (alreadyDecided(err)) {
        toast({ variant: "info", title: "Someone already decided this request." });
        await refresh();
        onClose();
      }
    },
  });

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open && !approve.isPending) {
          onClose();
          setRole(DEFAULT_APPROVAL_ROLE);
          approve.reset();
        }
      }}
    >
      {request && (
        <DialogContent
          title={`Approve ${request.requester.name}?`}
          description={`They'll join ${request.project.name} with the role you choose.`}
          footer={
            <>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button icon={Check} loading={approve.isPending} onClick={() => approve.mutate(request)}>
                Approve request
              </Button>
            </>
          }
        >
          <RadioGroup
            legend="Role"
            options={ROLE_OPTIONS}
            value={role}
            onValueChange={(v) => setRole(v as ProjectRole)}
          />
          {approve.isError && !alreadyDecided(approve.error) && (
            <p role="alert" className="rounded-control bg-danger-soft p-3 text-secondary text-danger-ink">
              {FAILED}
            </p>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

function DenyDialog({ me, request, onClose }: { me: MeResponse; request: QueueRequest | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const { refresh, alreadyDecided } = useDecisionDone();

  return (
    <ConfirmDialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setReason("");
        }
      }}
      title={request ? `Deny ${request.requester.name}'s request?` : ""}
      description={request ? `They won't join ${request.project.name}. Your reason is shown to them.` : ""}
      confirmLabel="Deny request"
      confirmIcon={X}
      confirmAction={CONFIRM_ACTIONS.denyAccessRequest}
      confirmDisabled={reason.trim().length === 0}
      successMessage="Request denied."
      onConfirm={async (confirmation) => {
        if (!request) return;
        try {
          await api(`/api/access-requests/${request.id}/deny`, {
            body: { reason },
            csrfToken: me.csrfToken,
            headers: confirmation,
          });
        } catch (err) {
          if (!alreadyDecided(err)) throw err;
          toast({ variant: "info", title: "Someone already decided this request." });
        }
        await refresh();
      }}
    >
      <Field label="Reason" hint="A short sentence. It's shown to the person who asked." required>
        <Textarea value={reason} maxLength={REASON_MAX} rows={3} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </ConfirmDialog>
  );
}

/** AUTH-9. Until email arrives in Stage 5, the inviter copies the link and sends it themselves. */
function InviteForm({ me, projects }: { me: MeResponse; projects: AccessQueueResponse["invitableProjects"] }) {
  const [projectId, setProjectId] = useState(projects.length === 1 ? String(projects[0]!.id) : "");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRole>(DEFAULT_APPROVAL_ROLE);
  const [errors, setErrors] = useState<{ project?: string; email?: string }>({});
  const [link, setLink] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api(`/api/projects/${projectId}/invites`, { body: { email, role }, csrfToken: me.csrfToken }).then((b) =>
        createInviteResponse.parse(b),
      ),
    onSuccess: (body) => {
      setLink(body.link);
      setEmail("");
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === ACCESS_ERRORS.invalid) {
        setErrors({ email: "Enter an email address, like name@example.com." });
      }
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const next: typeof errors = {};
    if (!projectId) next.project = "Choose a project.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = "Enter an email address, like name@example.com.";
    setErrors(next);
    setLink(null);
    if (Object.keys(next).length === 0) create.mutate();
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="invite-heading">
      <div className="flex flex-col gap-1">
        <h2 id="invite-heading" className="text-body font-semibold text-ink">
          Invite someone
        </h2>
        <p className="text-secondary text-ink-2">
          The link works once, for 7 days, and only for the Google account with this email address.
        </p>
      </div>
      <form className="flex flex-col gap-4 rounded-card border border-line bg-card p-4" onSubmit={handleSubmit} noValidate>
        <Field label="Project" error={errors.project} required>
          <Select
            options={projects.map((p) => ({ value: String(p.id), label: p.name }))}
            value={projectId}
            onValueChange={setProjectId}
          />
        </Field>
        <Field label="Email" error={errors.email} required>
          <TextInput type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <RadioGroup legend="Role" options={ROLE_OPTIONS} value={role} onValueChange={(v) => setRole(v as ProjectRole)} />
        {create.isError && !(create.error instanceof ApiError && create.error.code === ACCESS_ERRORS.invalid) && (
          <p role="alert" className="rounded-control bg-danger-soft p-3 text-secondary text-danger-ink">
            {FAILED}
          </p>
        )}
        <div>
          <Button type="submit" icon={UserPlus} loading={create.isPending}>
            Create invite link
          </Button>
        </div>
      </form>
      {link && <InviteLink link={link} />}
    </section>
  );
}

function InviteLink({ link }: { link: string }) {
  return (
    <div role="status" className="flex flex-col gap-2 rounded-card border border-success-line bg-success-soft p-4">
      <p className="text-secondary font-medium text-success-ink">
        Invite link created. Copy it now and send it to them; it won't be shown again.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-control bg-card px-3 py-2 text-secondary text-ink">{link}</code>
        <Button
          variant="secondary"
          icon={Copy}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              toast({ variant: "success", title: "Link copied." });
            } catch {
              toast({ variant: "error", title: "Couldn't copy. Select the link and copy it instead." });
            }
          }}
        >
          Copy link
        </Button>
      </div>
    </div>
  );
}
