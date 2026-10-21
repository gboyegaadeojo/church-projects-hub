import { describe, expect, it } from "vitest";
import { type Actor, can, OWN_TASK_DELETE_WINDOW_MS, type ProjectContext } from "../worker/auth/permissions";
import { MATRIX_ROLES, type MatrixRole } from "./helpers/fixtures";
import { PERMISSION_MATRIX } from "./helpers/matrix";

// Unit tests of the permission function: one per row of the section 2 matrix (section 17).

const ACTOR_ID = 7;
const project = (role: ProjectContext["role"], extra: Partial<ProjectContext> = {}): ProjectContext => ({
  id: 1,
  archived: false,
  isSystem: false,
  role,
  ...extra,
});

function actorFor(role: MatrixRole): { actor: Actor; ctx: ProjectContext } {
  switch (role) {
    case "appAdmin":
      return { actor: { id: ACTOR_ID, appRole: "admin", status: "active" }, ctx: project(null) };
    case "projectAdmin":
      return { actor: { id: ACTOR_ID, appRole: "member", status: "active" }, ctx: project("admin") };
    case "contributor":
      return { actor: { id: ACTOR_ID, appRole: "member", status: "active" }, ctx: project("contributor") };
    case "viewer":
      return { actor: { id: ACTOR_ID, appRole: "member", status: "active" }, ctx: project("viewer") };
    case "pending":
      return { actor: { id: ACTOR_ID, appRole: "member", status: "pending" }, ctx: project(null) };
  }
}

describe("Section 2 permission matrix — can()", () => {
  it.each(PERMISSION_MATRIX)("$row", ({ action, allowed, resource }) => {
    for (const role of MATRIX_ROLES) {
      const { actor, ctx } = actorFor(role);
      expect({ role, result: can(actor, action, ctx, resource?.(ACTOR_ID)) }).toEqual({ role, result: allowed[role] });
    }
  });
});

describe("Section 2 permission rules beyond the matrix cells", () => {
  const member: Actor = { id: ACTOR_ID, appRole: "member", status: "active" };
  const appAdmin: Actor = { id: ACTOR_ID, appRole: "admin", status: "active" };

  it("Suspended people can do nothing, whatever their roles", () => {
    const suspendedAdmin: Actor = { ...appAdmin, status: "suspended" };
    for (const { action } of PERMISSION_MATRIX) expect(can(suspendedAdmin, action, project("admin"))).toBe(false);
  });

  it("members see only their own projects", () => {
    expect(can(member, "task.view", project(null))).toBe(false);
  });

  it("Contributors may delete only their own tasks, and only within 24 hours", () => {
    const now = Date.now();
    const ctx = project("contributor");
    expect(can(member, "task.delete", ctx, { task: { reporterId: ACTOR_ID, createdAt: now - 1000 } }, now)).toBe(true);
    expect(can(member, "task.delete", ctx, { task: { reporterId: 99, createdAt: now - 1000 } }, now)).toBe(false);
    expect(
      can(member, "task.delete", ctx, { task: { reporterId: ACTOR_ID, createdAt: now - OWN_TASK_DELETE_WINDOW_MS - 1 } }, now),
    ).toBe(false);
    expect(can(member, "task.delete", ctx)).toBe(false);
  });

  it("v4.7 Project Admins run their own project: any member's role, its details, archive and restore", () => {
    expect(can(member, "member.changeRole", project("admin"), { targetMemberRole: "admin" })).toBe(true);
    expect(can(member, "member.changeRole", project("admin"), { targetMemberRole: "viewer" })).toBe(true);
    expect(can(appAdmin, "member.changeRole", project(null), { targetMemberRole: "admin" })).toBe(true);
    expect(can(member, "project.edit", project("admin"))).toBe(true);
    // Restoring works on an archived project.
    expect(can(member, "project.edit", project("admin", { archived: true }))).toBe(true);
    for (const role of ["contributor", "viewer", null] as const) expect(can(member, "project.edit", project(role))).toBe(false);
    // Creating projects stays with App Admins.
    expect(can(member, "project.manage")).toBe(false);
  });

  it("PROJ-4: archived projects are read-only for everyone", () => {
    const archived = project("admin", { archived: true });
    expect(can(member, "task.view", archived)).toBe(true);
    expect(can(member, "report.view", archived)).toBe(true);
    for (const action of ["task.edit", "task.comment", "access.approve", "workflow.edit", "invite.create"] as const) {
      expect(can(member, action, archived)).toBe(false);
      expect(can(appAdmin, action, project(null, { archived: true }))).toBe(false);
    }
  });

  it("PROJ-7: the Hub Feedback system project is App Admins only, even for its listed members", () => {
    const system = project("admin", { isSystem: true });
    expect(can(member, "task.view", system)).toBe(false);
    expect(can(appAdmin, "task.view", project(null, { isSystem: true }))).toBe(true);
  });

  it("project actions without a project are refused", () => {
    expect(can(appAdmin, "task.view", null)).toBe(false);
  });

  it("inviting follows the 'Approve access requests' row", () => {
    expect(can(member, "invite.create", project("admin"))).toBe(true);
    expect(can(member, "invite.create", project("contributor"))).toBe(false);
    expect(can(appAdmin, "invite.create", project(null))).toBe(true);
  });
});
