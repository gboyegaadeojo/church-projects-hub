import type { Db } from "./db/client";
import { auditLog } from "./db/schema";

// Audit log events (section 6). Append-only; every event records actor, target, time and IP hash.
// Names are `area.event`; more are added stage by stage.
export const AUDIT = {
  firstSignIn: "user.first_sign_in",
  sessionRevoked: "session.revoked",
  signInRateLimited: "signin.rate_limited",
  requestSubmitted: "access.request_submitted",
  requestApproved: "access.request_approved",
  requestDenied: "access.request_denied",
  inviteSent: "invite.sent",
  inviteUsed: "invite.used",
  projectCreated: "project.created",
  projectEdited: "project.edited",
  projectHiddenChanged: "project.hidden_changed",
  // Workflow: columns, labels, components or milestones changed (section 6).
  workflowChanged: "workflow.changed",
  // Destructive actions (section 6, 11.14).
  taskDeleted: "task.deleted",
  commentDeleted: "comment.deleted",
  subtaskDeleted: "subtask.deleted",
  attachmentDeleted: "attachment.deleted",
  savedFilterDeleted: "saved_filter.deleted",
  // Content (section 6).
  newsPublished: "news.published",
  newsEdited: "news.edited",
} as const;
export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];

export type AuditTargetType =
  | "user"
  | "session"
  | "ip"
  | "access_request"
  | "invite"
  | "project"
  | "task"
  | "comment"
  | "subtask"
  | "attachment"
  | "label"
  | "component"
  | "milestone"
  | "saved_filter"
  | "news";

export type AuditEvent = {
  actorId: number | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | number;
  detail?: Record<string, unknown>;
  ipHash: string | null;
};

/** The same insert as a raw D1 statement, for batches written in SQL (tasks). */
export function auditStatement(env: Pick<Env, "DB">, event: AuditEvent, at: number = Date.now()) {
  return env.DB.prepare(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, detail_json, ip_hash, at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  ).bind(
    event.actorId,
    event.action,
    event.targetType,
    String(event.targetId),
    JSON.stringify(event.detail ?? {}),
    event.ipHash,
    at,
  );
}

/** Insert statement for one audit event, so callers can batch it with the change it records. */
export function auditInsert(db: Db, event: AuditEvent) {
  return db.insert(auditLog).values({
    actorId: event.actorId,
    action: event.action,
    targetType: event.targetType,
    targetId: String(event.targetId),
    detailJson: JSON.stringify(event.detail ?? {}),
    ipHash: event.ipHash,
  });
}
