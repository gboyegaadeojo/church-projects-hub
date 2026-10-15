import type { Action, ResourceContext } from "../../worker/auth/permissions";
import type { MatrixRole } from "./fixtures";

// The permission matrix in docs/REQUIREMENTS.md section 2, transcribed row by row.
// Rows that depend on the target use a resource the conditional role IS allowed on;
// the conditions themselves have their own tests.

type Row = {
  row: string;
  action: Action;
  allowed: Record<MatrixRole, boolean>;
  /** Built per actor: e.g. a task the actor created a moment ago. */
  resource?: (actorId: number) => ResourceContext;
};

const all = { appAdmin: true, projectAdmin: true, contributor: true, viewer: true, pending: true };
const appAdminOnly = { appAdmin: true, projectAdmin: false, contributor: false, viewer: false, pending: false };

export const PERMISSION_MATRIX: Row[] = [
  {
    row: "See a project's tasks",
    action: "task.view",
    allowed: { appAdmin: true, projectAdmin: true, contributor: true, viewer: true, pending: false },
  },
  {
    row: "Create, edit, move tasks",
    action: "task.edit",
    allowed: { appAdmin: true, projectAdmin: true, contributor: true, viewer: false, pending: false },
  },
  {
    row: "Comment and @mention",
    action: "task.comment",
    allowed: { appAdmin: true, projectAdmin: true, contributor: true, viewer: true, pending: false },
  },
  {
    row: "Delete a task (Contributor: own tasks only, within 24 hours)",
    action: "task.delete",
    allowed: { appAdmin: true, projectAdmin: true, contributor: true, viewer: false, pending: false },
    resource: (actorId) => ({ task: { reporterId: actorId, createdAt: Date.now() - 60_000 } }),
  },
  {
    row: "Approve access requests",
    action: "access.approve",
    allowed: { appAdmin: true, projectAdmin: true, contributor: false, viewer: false, pending: false },
  },
  {
    row: "Change member roles (Project Admin: own project, not other admins)",
    action: "member.changeRole",
    allowed: { appAdmin: true, projectAdmin: true, contributor: false, viewer: false, pending: false },
    resource: () => ({ targetMemberRole: "contributor" }),
  },
  {
    row: "Edit workflow, labels, components",
    action: "workflow.edit",
    allowed: { appAdmin: true, projectAdmin: true, contributor: false, viewer: false, pending: false },
  },
  { row: "Create or archive projects", action: "project.manage", allowed: appAdminOnly },
  {
    row: "View reports",
    action: "report.view",
    allowed: { appAdmin: true, projectAdmin: true, contributor: true, viewer: true, pending: false },
  },
  { row: "Submit bug or feature request", action: "feedback.submit", allowed: all },
  { row: "Publish What's New", action: "news.publish", allowed: appAdminOnly },
  { row: "Read audit log", action: "audit.read", allowed: appAdminOnly },
  { row: "Export audit log to CSV", action: "audit.export", allowed: appAdminOnly },
  { row: "Revoke another user's session", action: "session.revoke", allowed: appAdminOnly },
  { row: "Request own data deletion", action: "data.requestDeletion", allowed: all },
];
