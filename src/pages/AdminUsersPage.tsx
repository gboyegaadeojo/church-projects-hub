import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, Search, ShieldCheck, ShieldOff, UserCheck, UserX, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { ADMIN_CONFIRM, ADMIN_COPY, ADMIN_ERRORS, type AdminUserRow, adminUserDetail, adminUsersResponse, type UserSort } from "../../shared/admin";
import type { MeResponse } from "../../shared/auth";
import { ADMIN_CRUMBS, useMe } from "../components/shell/AppShell";
import { PageLayout } from "../components/shell/PageLayout";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/choices";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Dialog, SheetContent } from "../components/ui/Dialog";
import { Field } from "../components/ui/Field";
import { TextInput } from "../components/ui/inputs";
import { Skeleton } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { type Column, type SortState, Table } from "../components/ui/Table";
import { toast } from "../components/ui/Toast";
import { api, ApiError } from "../lib/api";

// The user directory (ADM-2, section 11.12): search, sort, each person's projects and roles, suspend and
// restore (type the email to suspend), App Admin role, and sign out everywhere. The API enforces all of it.

const FAILED = "That didn't go through. Check your connection and try again.";
const PAGE_SIZE = 50;
const STATUS_OPTIONS = [
  { value: "all", label: "Everyone" },
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "suspended", label: "Suspended" },
  { value: "admins", label: "App Admins" },
];
const SORT_KEYS: Record<string, UserSort> = { name: "name", email: "email", status: "status", lastSeen: "lastSeen" };

function failure(err: unknown): string {
  if (err instanceof ApiError && err.code === ADMIN_ERRORS.lastAdmin) return ADMIN_COPY.lastAdmin;
  if (err instanceof ApiError && err.code === ADMIN_ERRORS.self) return ADMIN_COPY.self;
  return FAILED;
}

function StatusBadge({ status }: { status: AdminUserRow["status"] }) {
  if (status === "active") return <Badge tone="success">Active</Badge>;
  if (status === "pending") return <Badge tone="info">Pending</Badge>;
  return <Badge tone="error">Suspended</Badge>;
}

export function AdminUsersPage() {
  const me = useMe();
  return (
    <PageLayout breadcrumbs={ADMIN_CRUMBS} title="Users">
      {me.user.appRole === "admin" ? <UserDirectory me={me} />
 : <EmptyState icon={Users} title="Only app admins can manage users." />}
    </PageLayout>
  );
}

function UserDirectory({ me }: { me: MeResponse }) {
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<SortState>({ key: "name", direction: "ascending" });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(typed.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [typed]);

  const params = new URLSearchParams({ q, sort: SORT_KEYS[sort.key] ?? "name", dir: sort.direction === "descending" ? "desc" : "asc", page: String(page) });
  if (filter === "admins") params.set("role", "admin");
  else if (filter !== "all") params.set("status", filter);
  const users = useQuery({
    queryKey: ["admin", "users", params.toString()],
    queryFn: async () => adminUsersResponse.parse(await api(`/api/admin/users?${params}`)),
    placeholderData: keepPreviousData,
  });
  const dateFormat = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: me.user.timezone });

  const columns: Column<AdminUserRow>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      cell: (u) => (
        <span className="flex items-center gap-3">
          <Avatar name={u.name} url={u.avatarUrl} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className="font-medium text-ink">
              {u.name}
              {u.id === me.user.id && <span className="text-ink-2"> (you)</span>}
            </span>
            {u.appRole === "admin" && <span className="text-caption text-ink-2">App Admin</span>}
          </span>
        </span>
      ),
    },
    // ADM-2: the email is shown so admins can spot duplicate accounts.
    { key: "email", header: "Email", sortable: true, cell: (u) => <span className="break-all">{u.email}</span> },
    { key: "status", header: "Status", sortable: true, cell: (u) => <StatusBadge status={u.status} /> },
    { key: "projects", header: "Projects", numeric: true, cell: (u) => u.projectCount },
    { key: "lastSeen", header: "Last seen", sortable: true, numeric: true, cell: (u) => (u.lastSeenAt ? dateFormat.format(u.lastSeenAt) : "Never") },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:flex-1">
          <Field label="Search by name or email" filter>
            <TextInput type="search" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </Field>
        </div>
        <div className="sm:w-48">
          <Field label="Show" filter>
            <Select
              options={STATUS_OPTIONS}
              value={filter}
              onValueChange={(v) => {
                setFilter(v);
                setPage(1);
              }}
            />
          </Field>
        </div>
      </div>
      {users.isError ? (
        <ErrorState title="We couldn't load users." description="Check your connection and try again." onRetry={() => void users.refetch()} retrying={users.isFetching} />
      ) : users.isPending ? (
        <div aria-busy="true" aria-label="Loading users" className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <Table
          caption="Users"
          captionHidden
          columns={columns}
          rows={users.data.users}
          getRowKey={(u) => String(u.id)}
          sort={sort}
          onSortChange={(next) => {
            setSort(next);
            setPage(1);
          }}
          rowActions={(u) => (
            <Button variant="secondary" onClick={() => setOpen(u.id)} aria-label={`Manage ${u.name}`}>
              Manage
            </Button>
          )}
          pagination={users.data.total > PAGE_SIZE ? { page, pageSize: PAGE_SIZE, total: users.data.total, onPageChange: setPage } : undefined}
          empty={<EmptyState icon={Search} title={q ? "No one matches that search." : "No users yet."} />}
        />
      )}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        {open !== null && <UserSheet me={me} userId={open} />}
      </Dialog>
    </div>
  );
}

function UserSheet({ me, userId }: { me: MeResponse; userId: number }) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["admin", "user", userId],
    queryFn: async () => adminUserDetail.parse(await api(`/api/admin/users/${userId}`)),
  });
  const [confirming, setConfirming] = useState<"suspend" | "revoke" | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });
  const dateFormat = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: me.user.timezone });

  async function run(path: string, body: unknown, success: string, method = "POST") {
    setBusy(true);
    try {
      await api(`/api/admin/users/${userId}/${path}`, { method, body, csrfToken: me.csrfToken });
      await refresh();
      toast({ variant: "success", title: success });
    } catch (err) {
      toast({ variant: "error", title: failure(err) });
    } finally {
      setBusy(false);
    }
  }

  const u = detail.data;
  const self = userId === me.user.id;
  return (
    <SheetContent title={u?.name ?? "User"}>
      {detail.isError ? (
        <ErrorState title="We couldn't load this person." description="Check your connection and try again." onRetry={() => void detail.refetch()} retrying={detail.isFetching} />
      ) : !u ? (
        <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-group">
          <div className="flex items-center gap-3">
            <Avatar name={u.name} url={u.avatarUrl} />
            <div className="min-w-0">
              <p className="break-all text-secondary text-ink-2">{u.email}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                <StatusBadge status={u.status} />
                {u.appRole === "admin" && <Badge tone="info">App Admin</Badge>}
              </div>
            </div>
          </div>

          <section aria-labelledby="projects-heading" className="flex flex-col gap-2">
            <h3 id="projects-heading" className="text-secondary font-semibold text-ink">
              Projects
            </h3>
            {u.memberships.length === 0 ? (
              <p className="text-secondary text-ink-2">Not in any project.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
                {u.memberships.map((m) => (
                  <li key={m.projectId} className="flex items-center justify-between gap-3 px-3 py-2 text-secondary">
                    <span className="text-ink">
                      {m.name} <span className="text-ink-2">({m.key})</span>
                    </span>
                    <span className="text-ink-2">{m.role === "admin" ? "Project Admin" : m.role === "contributor" ? "Contributor" : "Viewer"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="sessions-heading" className="flex flex-col gap-2">
            <h3 id="sessions-heading" className="text-secondary font-semibold text-ink">
              Signed in on
            </h3>
            {u.activeSessions.length === 0 ? (
              <p className="text-secondary text-ink-2">Not signed in anywhere.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-secondary text-ink-2">
                {u.activeSessions.map((s, i) => (
                  <li key={i}>
                    {s.device} · since {dateFormat.format(s.createdAt)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {self ? (
            <p className="text-secondary text-ink-2">{ADMIN_COPY.self}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {u.status === "active" &&
                (u.appRole === "admin" ? (
                  <Button variant="secondary" icon={ShieldOff} loading={busy} onClick={() => void run("role", { appRole: "member" }, "No longer an App Admin.", "PATCH")}>
                    Remove App Admin
                  </Button>
                ) : (
                  <Button variant="secondary" icon={ShieldCheck} loading={busy} onClick={() => void run("role", { appRole: "admin" }, "Now an App Admin.", "PATCH")}>
                    Make App Admin
                  </Button>
                ))}
              {u.activeSessions.length > 0 && u.status !== "suspended" && (
                <Button variant="secondary" icon={LogOut} onClick={() => setConfirming("revoke")}>
                  Sign out everywhere
                </Button>
              )}
              {u.status === "suspended" ? (
                <Button variant="secondary" icon={UserCheck} loading={busy} onClick={() => void run("restore", undefined, "User restored.")}>
                  Restore
                </Button>
              ) : (
                <Button variant="destructive" icon={UserX} onClick={() => setConfirming("suspend")}>
                  Suspend
                </Button>
              )}
            </div>
          )}

          <ConfirmDialog
            open={confirming === "suspend"}
            onOpenChange={(o) => !o && setConfirming(null)}
            title={`Suspend ${u.name}?`}
            description="They're signed out everywhere at once and can't sign in until an App Admin restores them."
            confirmLabel="Suspend user"
            confirmIcon={UserX}
            confirmAction={ADMIN_CONFIRM.suspend}
            confirmText={u.email}
            successMessage="User suspended."
            onConfirm={async (headers) => {
              await api(`/api/admin/users/${userId}/suspend`, { method: "POST", csrfToken: me.csrfToken, headers });
              await refresh();
              setConfirming(null);
            }}
          />
          <ConfirmDialog
            open={confirming === "revoke"}
            onOpenChange={(o) => !o && setConfirming(null)}
            title={`Sign ${u.name} out everywhere?`}
            description="They'll need to sign in again on every device. We'll email them to say an app admin did this."
            confirmLabel="Sign out everywhere"
            confirmIcon={LogOut}
            confirmAction={ADMIN_CONFIRM.revokeSessions}
            successMessage="Signed out everywhere."
            onConfirm={async (headers) => {
              await api(`/api/admin/users/${userId}/revoke-sessions`, { method: "POST", csrfToken: me.csrfToken, headers });
              await refresh();
              setConfirming(null);
            }}
          />
        </div>
      )}
    </SheetContent>
  );
}
