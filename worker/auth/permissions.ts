import type { ProjectRole } from "../../shared/access";
import type { User } from "../db/schema";

// The permission matrix in section 2, as one pure function. Every API route that touches a project or
// an admin-only capability calls this through requirePermission/authorize (NFR-1). Never the UI.

export const ACTIONS = [
  // One per row of the section 2 matrix, in order.
  "task.view", // See a project's tasks
  "task.edit", // Create, edit, move tasks
  "task.comment", // Comment and @mention
  "task.delete", // Delete a task
  "access.approve", // Approve access requests
  "member.changeRole", // Change member roles
  "workflow.edit", // Edit workflow, labels, components
  "project.manage", // Create projects, hide them, and manage any project
  "project.edit", // v4.7: edit own project's name, description, colour and icon; archive or restore it
  "report.view", // View reports
  "feedback.submit", // Submit bug or feature request
  "news.publish", // Publish What's New
  "audit.read", // Read audit log
  "audit.export", // Export audit log to CSV
  "session.revoke", // Revoke another user's session
  "data.requestDeletion", // Request own data deletion
  // Not a matrix row: section 2 has App Admins "manage users" (directory, suspend, restore, app roles; ADM-2).
  "user.manage",
  // Not a matrix row: inviting follows "Approve access requests" (section 2: Project Admins invite people).
  "invite.create",
] as const;
export type Action = (typeof ACTIONS)[number];

/** Actions about one project; the rest are app-wide. */
export const PROJECT_ACTIONS = new Set<Action>([
  "task.view",
  "task.edit",
  "task.comment",
  "task.delete",
  "access.approve",
  "member.changeRole",
  "workflow.edit",
  "report.view",
  "invite.create",
  "project.edit",
]);

/** Project actions that change something; an archived project is read-only (PROJ-4). */
const PROJECT_WRITES = new Set<Action>([
  "task.edit",
  "task.comment",
  "task.delete",
  "access.approve",
  "member.changeRole",
  "workflow.edit",
  "invite.create",
]);

/** What Pending users may do (section 2: only the request screen, feedback and data deletion). */
const PENDING_ALLOWED = new Set<Action>(["feedback.submit", "data.requestDeletion"]);

const ROLE_ALLOWS: Record<ProjectRole, Set<Action>> = {
  // v4.7: a Project Admin runs their project fully; only app-wide powers stay with App Admins.
  admin: new Set(["task.view", "task.edit", "task.comment", "task.delete", "access.approve", "member.changeRole", "workflow.edit", "report.view", "invite.create", "project.edit"]),
  contributor: new Set(["task.view", "task.edit", "task.comment", "task.delete", "report.view"]),
  viewer: new Set(["task.view", "task.comment", "report.view"]),
};

/** Contributors may delete their own tasks within 24 hours of creating them. */
export const OWN_TASK_DELETE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type Actor = Pick<User, "id" | "appRole" | "status">;

export type ProjectContext = {
  id: number;
  archived: boolean;
  /** Hub Feedback (PROJ-7): only App Admins, whatever project_members says. */
  isSystem: boolean;
  /** The actor's role on this project, or null if not a member. */
  role: ProjectRole | null;
};

export type ResourceContext = {
  /** task.delete: who created the task and when. */
  task?: { reporterId: number; createdAt: number };
  /** member.changeRole: the member whose role would change. */
  targetMemberRole?: ProjectRole;
};

export function can(
  actor: Actor,
  action: Action,
  project: ProjectContext | null = null,
  resource: ResourceContext = {},
  now: number = Date.now(),
): boolean {
  if (actor.status === "suspended") return false;
  if (actor.status === "pending") return PENDING_ALLOWED.has(action);

  const isAppAdmin = actor.appRole === "admin";

  if (!PROJECT_ACTIONS.has(action)) {
    // App-wide rows.
    if (action === "feedback.submit" || action === "data.requestDeletion") return true;
    return isAppAdmin;
  }

  if (!project) return false;
  if (project.archived && PROJECT_WRITES.has(action)) return false;
  if (isAppAdmin) return true;
  if (project.isSystem || !project.role) return false;

  const role = project.role;
  if (!ROLE_ALLOWS[role].has(action)) return false;

  if (action === "task.delete" && role === "contributor") {
    const task = resource.task;
    return !!task && task.reporterId === actor.id && now - task.createdAt <= OWN_TASK_DELETE_WINDOW_MS;
  }
  // v4.7: Project Admins change any member's role here, other admins included; the route keeps at least one admin.
  return true;
}
