import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, UserMinus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { MANAGE_CONFIRM, type MemberRow, membersResponse, ROLE_RANK } from "../../shared/admin";
import { projectResponse } from "../../shared/projects";
import { useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Avatar } from "../components/ui/Avatar";
import { Button, buttonClasses } from "../components/ui/Button";
import { Select } from "../components/ui/choices";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Field } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { toast } from "../components/ui/Toast";
import { api } from "../lib/api";

// A project's members (PROJ-5) and, for its admins, role changes and removal (section 2 "Change member
// roles"). Lowering a role or removing someone goes through the confirmation dialog (section 11.14).
// The API decides who may change whom; the controls here only follow it.

const FAILED = "That didn't go through. Check your connection and try again.";
const ROLE_LABELS: Record<MemberRow["role"], string> = { admin: "Project Admin", contributor: "Contributor", viewer: "Viewer" };

type Pending = { member: MemberRow; kind: "lower"; role: MemberRow["role"] } | { member: MemberRow; kind: "remove" };

export function ProjectMembersPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const { key = "" } = useParams();
  const project = useQuery({
    queryKey: ["projects", "by-key", key.toUpperCase()],
    queryFn: async () => projectResponse.parse(await api(`/api/projects/by-key/${encodeURIComponent(key)}`)).project,
  });
  const membersKey = ["projects", project.data?.id, "members"];
  const members = useQuery({
    queryKey: membersKey,
    enabled: !!project.data,
    queryFn: async () => membersResponse.parse(await api(`/api/projects/${project.data!.id}/members`)),
  });
  const [pending, setPending] = useState<Pending | null>(null);
  const isAppAdmin = me.user.appRole === "admin";

  async function changeRole(member: MemberRow, role: MemberRow["role"], headers?: Record<string, string>) {
    await api(`/api/projects/${project.data!.id}/members/${member.userId}`, { method: "PATCH", body: { role }, csrfToken: me.csrfToken, headers });
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
  }

  function pickRole(member: MemberRow, role: MemberRow["role"]) {
    if (role === member.role) return;
    if (ROLE_RANK[role] < ROLE_RANK[member.role]) {
      setPending({ member, kind: "lower", role });
      return;
    }
    changeRole(member, role)
      .then(() => toast({ variant: "success", title: "Role changed." }))
      .catch(() => toast({ variant: "error", title: FAILED }));
  }

  /** Whether this person may change that member (mirrors the API: only App Admins change Project Admins). */
  const editable = (m: MemberRow) => members.data?.canManage && m.userId !== me.user.id && (isAppAdmin || m.role !== "admin");
  const roleOptions = (["admin", "contributor", "viewer"] as const)
    .filter((r) => isAppAdmin || r !== "admin")
    .map((r) => ({ value: r, label: ROLE_LABELS[r] }));

  return (
    <PageLayout
      title={project.data ? `${project.data.name} members` : "Members"}
      actions={
        <Link to={`/projects/${key}`} className={buttonClasses("secondary")}>
          <Icon icon={ArrowLeft} />
          Back to board
        </Link>
      }
    >
      {project.isError || members.isError ? (
        <ErrorState title="We couldn't load the members." description="Check your connection and try again." onRetry={() => void members.refetch()} retrying={members.isFetching} />
      ) : !members.data ? (
        <div aria-busy="true" aria-label="Loading members" className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : members.data.members.length === 0 ? (
        <EmptyState icon={Users} title="No members yet." />
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
          {members.data.members.map((m) => (
            <li key={m.userId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={m.name} url={m.avatarUrl} size="sm" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-ink">
                    {m.name}
                    {m.userId === me.user.id && <span className="text-ink-2"> (you)</span>}
                  </span>
                  <span className="truncate text-caption text-ink-2">{m.email}</span>
                </span>
              </span>
              {editable(m) ? (
                <span className="flex items-end gap-2">
                  <span className="w-44">
                    <Field label={`Role for ${m.name}`} filter>
                      <Select options={roleOptions} value={m.role} onValueChange={(r) => pickRole(m, r as MemberRow["role"])} />
                    </Field>
                  </span>
                  <Button variant="ghost" icon={UserMinus} onClick={() => setPending({ member: m, kind: "remove" })} aria-label={`Remove ${m.name}`}>
                    Remove
                  </Button>
                </span>
              ) : (
                <span className="text-secondary text-ink-2">{ROLE_LABELS[m.role]}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pending?.kind === "lower"}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? `Change ${pending.member.name} to ${pending.kind === "lower" ? ROLE_LABELS[pending.role] : ""}?` : ""}
        description="They lose the rights of their current role on this project straight away."
        confirmLabel="Change role"
        confirmAction={MANAGE_CONFIRM.lowerRole}
        successMessage="Role changed."
        onConfirm={async (headers) => {
          if (pending?.kind !== "lower") return;
          await changeRole(pending.member, pending.role, headers);
          setPending(null);
        }}
      />
      <ConfirmDialog
        open={pending?.kind === "remove"}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? `Remove ${pending.member.name} from ${project.data?.name ?? "this project"}?` : ""}
        description="They lose access to this project's tasks at once. Their tasks and comments stay."
        confirmLabel="Remove member"
        confirmIcon={UserMinus}
        confirmAction={MANAGE_CONFIRM.removeMember}
        successMessage="Member removed."
        onConfirm={async (headers) => {
          if (pending?.kind !== "remove") return;
          await api(`/api/projects/${project.data!.id}/members/${pending.member.userId}`, { method: "DELETE", csrfToken: me.csrfToken, headers });
          await queryClient.invalidateQueries({ queryKey: ["projects"] });
          setPending(null);
        }}
      />
    </PageLayout>
  );
}
