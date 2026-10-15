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
} as const;
export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];

export type AuditTargetType = "user" | "session" | "ip" | "access_request" | "invite" | "project";

export type AuditEvent = {
  actorId: number | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | number;
  detail?: Record<string, unknown>;
  ipHash: string | null;
};

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
