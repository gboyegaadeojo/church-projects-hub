import { z } from "zod";

// Administration (section 11.12; ADM-2 user directory). App Admins only; every change is audited.

export const ADMIN_CONFIRM = {
  suspend: "user.suspend",
  revokeSessions: "session.revoke",
  archiveProject: "project.archive",
} as const;

export const ADMIN_ERRORS = {
  /** Safety rule (section 2): the last App Admin can't be demoted or suspended. */
  lastAdmin: "last_app_admin",
  self: "not_on_yourself",
  systemProject: "system_project",
} as const;

export const ADMIN_COPY = {
  lastAdmin: "There must always be at least one App Admin. Make someone else an App Admin first.",
  self: "You can't do this to your own account. Ask another App Admin.",
} as const;

export const USER_SORTS = ["name", "email", "status", "lastSeen", "joined"] as const;
export type UserSort = (typeof USER_SORTS)[number];

export const adminUserRow = z.object({
  id: z.number().int(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  appRole: z.enum(["admin", "member"]),
  status: z.enum(["pending", "active", "suspended"]),
  lastSeenAt: z.number().nullable(),
  createdAt: z.number(),
  projectCount: z.number().int(),
});
export type AdminUserRow = z.infer<typeof adminUserRow>;

export const adminUsersResponse = z.object({ users: z.array(adminUserRow), total: z.number().int() });

export const adminUserDetail = adminUserRow.extend({
  timezone: z.string(),
  memberships: z.array(z.object({ projectId: z.number().int(), key: z.string(), name: z.string(), role: z.enum(["admin", "contributor", "viewer"]) })),
  /** Signed-in devices; the session ids themselves are credentials and never leave the server. */
  activeSessions: z.array(z.object({ createdAt: z.number(), expiresAt: z.number(), device: z.string() })),
});
export type AdminUserDetail = z.infer<typeof adminUserDetail>;

export const appRoleBody = z.object({ appRole: z.enum(["admin", "member"]) });

// ---- Invite management (ADM-7) and project members (section 2 "Change member roles")

export const MANAGE_CONFIRM = {
  cancelInvite: "invite.cancel",
  removeMember: "member.remove",
  lowerRole: "member.lower_role",
} as const;

export const INVITE_STATUSES = ["pending", "used", "expired", "cancelled"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const inviteRow = z.object({
  id: z.number().int(),
  email: z.string(),
  role: z.enum(["admin", "contributor", "viewer"]),
  project: z.object({ id: z.number().int(), key: z.string(), name: z.string() }),
  sentBy: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  status: z.enum(INVITE_STATUSES),
});
export type InviteRow = z.infer<typeof inviteRow>;
export const invitesResponse = z.object({ invites: z.array(inviteRow) });
export const resendInviteResponse = z.object({ link: z.string(), expiresAt: z.number() });

export const memberRow = z.object({
  userId: z.number().int(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(["admin", "contributor", "viewer"]),
  addedAt: z.number(),
});
export type MemberRow = z.infer<typeof memberRow>;
export const membersResponse = z.object({ members: z.array(memberRow), canManage: z.boolean() });
export const memberRoleBody = z.object({ role: z.enum(["admin", "contributor", "viewer"]) });

/** Higher number = more rights; a change to a lower number needs confirmation (section 11.14). */
export const ROLE_RANK = { viewer: 0, contributor: 1, admin: 2 } as const;

// ---- Audit log viewer (ADM-3, section 11.12)

export const AUDIT_PAGE_SIZE = 50;
/** ADM-3 / Stage 6: CSV exports stop at 5,000 rows; narrow the filters for more. */
export const AUDIT_EXPORT_CAP = 5000;

export const auditEntry = z.object({
  id: z.number().int(),
  at: z.number(),
  action: z.string(),
  actor: z.object({ id: z.number().int(), name: z.string() }).nullable(),
  targetType: z.string(),
  targetId: z.string(),
  detail: z.record(z.string(), z.unknown()),
});
export type AuditEntry = z.infer<typeof auditEntry>;
export const auditResponse = z.object({ entries: z.array(auditEntry), nextBefore: z.number().int().nullable(), actions: z.array(z.string()) });

// ---- Usage panel (ADM-4, ADM-5) against the free-tier limits in section 5 (per Cloudflare account, daily, UTC)

export const USAGE_METRICS = ["workerRequests", "d1RowsRead", "d1RowsWritten", "emails"] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export const FREE_LIMITS: Record<UsageMetric, { label: string; daily: number; monthly: number | null }> = {
  workerRequests: { label: "Worker requests", daily: 100_000, monthly: null },
  d1RowsRead: { label: "D1 rows read", daily: 5_000_000, monthly: null },
  d1RowsWritten: { label: "D1 rows written", daily: 100_000, monthly: null },
  emails: { label: "Emails sent", daily: 100, monthly: 3_000 },
};
export const USAGE_WARN_AT = 0.8;

export const usageResponse = z.object({
  /** False until CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN are set; emails still come from the outbox. */
  analyticsConnected: z.boolean(),
  analyticsError: z.boolean(),
  metrics: z.array(
    z.object({
      metric: z.enum(USAGE_METRICS),
      today: z.number().nullable(),
      month: z.number().nullable(),
      /** When today's 100% was first recorded, if it was. */
      limitReachedAt: z.number().nullable(),
    }),
  ),
  databaseBytes: z.number().nullable(),
  failedEmails: z.number().int(),
});
export type UsageResponse = z.infer<typeof usageResponse>;
