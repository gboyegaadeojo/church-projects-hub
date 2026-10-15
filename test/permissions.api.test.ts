import { beforeAll, describe, expect, it } from "vitest";
import { authorize, forbidden, idParam } from "../worker/auth/authorize";
import { requireSession } from "../worker/auth/middleware";
import { type Action, ACTIONS, type ResourceContext } from "../worker/auth/permissions";
import { app, call, type Client } from "./helpers/auth";
import { actorAs, createProject, MATRIX_ROLES, type MatrixRole } from "./helpers/fixtures";
import { PERMISSION_MATRIX } from "./helpers/matrix";

// API tests, one per row of the section 2 matrix (section 17): the allowed roles succeed, every other
// role gets 403. Most rows have no endpoint until later stages, so these go through test-only routes
// that run the real session check, the real middleware and real D1 lookups. Each row is tested again
// on its real endpoint in the stage that builds it (approving requests: test/access-requests.test.ts).

// Test-only route: POST /api/test/permission/:action/:projectId with { resource } in the body.
app.post("/test/permission/:action/:projectId", requireSession, async (c) => {
  const action = c.req.param("action") as Action;
  if (!ACTIONS.includes(action)) return c.json({ error: "unknown action" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { resource?: ResourceContext };
  const result = await authorize(c, action, idParam(c, "projectId"), body.resource ?? {});
  return result.ok ? c.json({ ok: true }) : forbidden(c, result.status);
});

let projectId: number;
const actors = {} as Record<MatrixRole, Client>;

beforeAll(async () => {
  projectId = (await createProject()).id;
  for (const role of MATRIX_ROLES) actors[role] = await actorAs(role, projectId);
});

describe("NFR-1 Section 2 permission matrix through the API", () => {
  it.each(PERMISSION_MATRIX)("$row", async ({ action, allowed, resource }) => {
    for (const role of MATRIX_ROLES) {
      const actor = actors[role];
      const res = await call(actor, "POST", `/api/test/permission/${action}/${projectId}`, {
        resource: resource?.(actor.userId),
      });
      expect({ role, status: res.status }).toEqual({ role, status: allowed[role] ? 200 : 403 });
    }
  });

  it("a Project Admin of one project gets 403 on another project", async () => {
    const other = (await createProject()).id;
    const res = await call(actors.projectAdmin, "POST", `/api/test/permission/task.view/${other}`, {});
    expect(res.status).toBe(403);
  });

  it("a project that doesn't exist is 404, not 403", async () => {
    const res = await call(actors.appAdmin, "POST", "/api/test/permission/task.view/999999", {});
    expect(res.status).toBe(404);
  });

  it("is checked on every request: removing someone's role takes effect immediately", async () => {
    const { env } = await import("cloudflare:workers");
    const contributor = await actorAs("contributor", projectId);
    expect((await call(contributor, "POST", `/api/test/permission/task.edit/${projectId}`, {})).status).toBe(200);
    await env.DB.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?")
      .bind(projectId, contributor.userId)
      .run();
    expect((await call(contributor, "POST", `/api/test/permission/task.edit/${projectId}`, {})).status).toBe(403);
  });
});
