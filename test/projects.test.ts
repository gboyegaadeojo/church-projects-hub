import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_WORKFLOW, HUB_FEEDBACK, PROJECT_COPY, type ProjectSummary } from "../shared/projects";
import { ensureHubFeedback } from "../worker/projects/routes";
import { call, type Client, signedInClient } from "./helpers/auth";
import { actorAs, auditFor, createProject, MATRIX_ROLES, type MatrixRole, setUser } from "./helpers/fixtures";

// Projects (PROJ-1, PROJ-6, PROJ-7) and the theme preference on the profile, against the real API and D1.

let keyCounter = 0;
/** A key no other test uses: 2 letters + a counter + random letters, at most 10 characters. */
function freshKey(): string {
  keyCounter += 1;
  const letters = crypto.randomUUID().replace(/[^a-f]/g, "").slice(0, 4).toUpperCase();
  return `P${keyCounter}${letters}`.slice(0, 10);
}

const validProject = (key = freshKey()) => ({
  name: "Media",
  key,
  description: "Sound, lighting, stream and slides.",
  colour: "teal",
  icon: "video",
});

async function workflowOf(projectId: number) {
  const { results } = await env.DB.prepare(
    "SELECT name, category, position FROM workflow_states WHERE project_id = ? ORDER BY position",
  )
    .bind(projectId)
    .all<{ name: string; category: string; position: number }>();
  return results;
}

async function hubFeedbackRows() {
  const { results } = await env.DB.prepare("SELECT * FROM projects WHERE is_system = 1").all<Record<string, unknown>>();
  return results;
}

let actors: Record<MatrixRole, Client>;
let teamProject: { id: number; key: string; name: string };

beforeAll(async () => {
  teamProject = await createProject();
  actors = {} as Record<MatrixRole, Client>;
  for (const role of MATRIX_ROLES) actors[role] = await actorAs(role, teamProject.id);
});

describe("PROJ-1 Creating a project", () => {
  it("an App Admin creates a project with the default columns, audited", async () => {
    const key = freshKey();
    const res = await call(actors.appAdmin, "POST", "/api/projects", { ...validProject(key.toLowerCase()), hidden: false });
    expect(res.status).toBe(201);
    const { project } = (await res.json()) as { project: ProjectSummary };
    // The key is stored in capitals whatever was typed.
    expect(project).toMatchObject({
      key,
      name: "Media",
      colour: "teal",
      icon: "video",
      hidden: false,
      isSystem: false,
      archived: false,
      role: null,
    });

    // PROJ-2 / section 18: Backlog, To Do, In Progress, In Review, Done with their report categories.
    expect(await workflowOf(project.id)).toEqual(
      DEFAULT_WORKFLOW.map((s, position) => ({ name: s.name, category: s.category, position })),
    );
    const audit = await auditFor("project.created", project.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: actors.appAdmin.userId, detail: { key, name: "Media", hidden: false } });
  });

  it("Project Admins, Contributors, Viewers and Pending users get 403 and nothing is created", async () => {
    for (const role of ["projectAdmin", "contributor", "viewer", "pending"] as const) {
      const key = freshKey();
      const res = await call(actors[role], "POST", "/api/projects", validProject(key));
      expect({ role, status: res.status }).toEqual({ role, status: 403 });
      expect(await env.DB.prepare("SELECT 1 FROM projects WHERE key = ?").bind(key).first()).toBeNull();
    }
  });

  it("rejects a key already in use with the section 14 style message, and writes nothing", async () => {
    const key = freshKey();
    expect((await call(actors.appAdmin, "POST", "/api/projects", validProject(key))).status).toBe(201);
    const res = await call(actors.appAdmin, "POST", "/api/projects", { ...validProject(key), name: "Another" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "key_taken", message: PROJECT_COPY.keyTaken });
    const { n } = (await env.DB.prepare("SELECT count(*) AS n FROM projects WHERE key = ?").bind(key).first<{ n: number }>())!;
    expect(n).toBe(1);
  });

  it.each([
    ["an empty name", { name: "  " }],
    ["a one-letter key", { key: "M" }],
    ["a key starting with a number", { key: "1MEDIA" }],
    ["a key with spaces", { key: "MY TEAM" }],
    ["a key over 10 characters", { key: "ABCDEFGHIJK" }],
    ["the reserved Hub Feedback key", { key: HUB_FEEDBACK.key }],
    ["an unknown colour", { colour: "#ff0000" }],
    ["an unknown icon", { icon: "skull" }],
  ])("rejects %s with 400", async (_, override) => {
    const res = await call(actors.appAdmin, "POST", "/api/projects", { ...validProject(), ...override });
    expect(res.status).toBe(400);
  });
});

describe("PROJ-6 Hidden projects", () => {
  it("an App Admin hides a project: it leaves the request screen, and the change is audited", async () => {
    const p = await createProject();
    const pending = await signedInClient();
    const requestable = async () =>
      ((await (await call(pending, "GET", "/api/projects/requestable")).json()) as { projects: { id: number }[] }).projects.map(
        (x) => x.id,
      );
    expect(await requestable()).toContain(p.id);

    const res = await call(actors.appAdmin, "PATCH", `/api/projects/${p.id}`, { hidden: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { project: ProjectSummary }).project.hidden).toBe(true);
    expect(await requestable()).not.toContain(p.id);

    const audit = await auditFor("project.hidden_changed", p.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: actors.appAdmin.userId, detail: { key: p.key, hidden: true } });
    // Only the hidden flag changed: no "edited" event.
    expect(await auditFor("project.edited", p.id)).toHaveLength(0);
  });

  it("creating a project as hidden keeps it off the request screen from the start", async () => {
    const res = await call(actors.appAdmin, "POST", "/api/projects", { ...validProject(), hidden: true });
    const { project } = (await res.json()) as { project: ProjectSummary };
    const pending = await signedInClient();
    const { projects } = (await (await call(pending, "GET", "/api/projects/requestable")).json()) as { projects: { id: number }[] };
    expect(projects.map((x) => x.id)).not.toContain(project.id);
  });

  it("editing name, colour and icon is audited once with the fields that changed; the key can't change", async () => {
    const p = await createProject();
    const res = await call(actors.appAdmin, "PATCH", `/api/projects/${p.id}`, {
      name: "Renamed",
      colour: "blue", // unchanged (fixtures use blue)
      icon: "music",
      key: "NEWKEY",
    });
    expect(res.status).toBe(200);
    const { project } = (await res.json()) as { project: ProjectSummary };
    expect(project).toMatchObject({ name: "Renamed", icon: "music", key: p.key });
    const audit = await auditFor("project.edited", p.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.detail).toEqual({ key: p.key, fields: ["name", "icon"] });
  });

  it("only App Admins can edit or hide a project", async () => {
    for (const role of ["projectAdmin", "contributor", "viewer", "pending"] as const) {
      const res = await call(actors[role], "PATCH", `/api/projects/${teamProject.id}`, { hidden: true });
      expect({ role, status: res.status }).toEqual({ role, status: 403 });
    }
    const row = await env.DB.prepare("SELECT hidden FROM projects WHERE id = ?").bind(teamProject.id).first<number>("hidden");
    expect(row).toBe(0);
  });

  it("returns 404 for a project that doesn't exist", async () => {
    expect((await call(actors.appAdmin, "PATCH", "/api/projects/999999", { hidden: true })).status).toBe(404);
  });
});

describe("PROJ-7 Hub Feedback", () => {
  it("is created when an App Admin loads the app, once, hidden and system, with columns and an audit event", async () => {
    const admin = await signedInClient();
    await setUser(admin.userId, { status: "active", appRole: "admin" });
    // Twice: the second load must not create a second copy.
    expect((await call(admin, "GET", "/api/auth/me")).status).toBe(200);
    expect((await call(admin, "GET", "/api/auth/me")).status).toBe(200);
    await ensureHubFeedback(env);

    const rows = await hubFeedbackRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: HUB_FEEDBACK.key, name: HUB_FEEDBACK.name, hidden: 1, is_system: 1, archived_at: null });
    const id = rows[0]!.id as number;
    expect((await workflowOf(id)).map((s) => s.name)).toEqual(DEFAULT_WORKFLOW.map((s) => s.name));
    expect(await auditFor("project.created", id)).toHaveLength(1);
  });

  it("is re-created if it goes missing", async () => {
    await ensureHubFeedback(env);
    const [row] = await hubFeedbackRows();
    // Simulate a lost row: free the key and the system flag, as if it had never existed.
    await env.DB.prepare("UPDATE projects SET is_system = 0, key = 'GONE' || id WHERE id = ?").bind(row!.id).run();
    await ensureHubFeedback(env);
    const rows = await hubFeedbackRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe(row!.id);
  });

  it("is visible only to App Admins: in the project list and by key", async () => {
    await ensureHubFeedback(env);
    for (const role of MATRIX_ROLES) {
      const list = await call(actors[role], "GET", "/api/projects");
      const byKey = await call(actors[role], "GET", `/api/projects/by-key/${HUB_FEEDBACK.key}`);
      if (role === "appAdmin") {
        const { projects } = (await list.json()) as { projects: ProjectSummary[] };
        expect(projects.filter((p) => p.isSystem).map((p) => p.key)).toEqual([HUB_FEEDBACK.key]);
        expect(byKey.status).toBe(200);
      } else {
        if (role !== "pending") {
          const { projects } = (await list.json()) as { projects: ProjectSummary[] };
          expect(projects.some((p) => p.isSystem)).toBe(false);
        }
        expect({ role, status: byKey.status }).toEqual({ role, status: 403 });
      }
    }
  });

  it("cannot be edited or un-hidden, even by an App Admin", async () => {
    await ensureHubFeedback(env);
    const [row] = await hubFeedbackRows();
    const res = await call(actors.appAdmin, "PATCH", `/api/projects/${row!.id}`, { hidden: false });
    expect(res.status).toBe(403);
    expect((await hubFeedbackRows())[0]).toMatchObject({ hidden: 1 });
  });
});

describe("Section 2 Who sees which projects", () => {
  it("members see only their own team projects with their role; App Admins see all; Pending get 403", async () => {
    const other = await createProject();
    const hidden = await createProject({ hidden: true });
    const contributor = await actorAs("contributor", hidden.id);

    const mine = (await (await call(contributor, "GET", "/api/projects")).json()) as { projects: ProjectSummary[] };
    expect(mine.projects.map((p) => [p.key, p.role])).toEqual([[hidden.key, "contributor"]]);

    const all = (await (await call(actors.appAdmin, "GET", "/api/projects")).json()) as { projects: ProjectSummary[] };
    expect(all.projects.map((p) => p.key)).toEqual(expect.arrayContaining([other.key, hidden.key, teamProject.key]));

    expect((await call(actors.pending, "GET", "/api/projects")).status).toBe(403);
  });

  it("a project page by key: members 200, non-members 403, unknown keys 404", async () => {
    expect((await call(actors.viewer, "GET", `/api/projects/by-key/${teamProject.key.toLowerCase()}`)).status).toBe(200);
    const outsider = await actorAs("contributor", (await createProject()).id);
    expect((await call(outsider, "GET", `/api/projects/by-key/${teamProject.key}`)).status).toBe(403);
    expect((await call(actors.appAdmin, "GET", "/api/projects/by-key/NOSUCHKEY")).status).toBe(404);
  });
});

describe("Section 9 Theme preference on the profile", () => {
  it("is saved on the user and returned by /me", async () => {
    const client = await signedInClient();
    expect(((await (await call(client, "GET", "/api/auth/me")).json()) as { user: { theme: string } }).user.theme).toBe("system");
    const res = await call(client, "PATCH", "/api/me/preferences", { theme: "dark" });
    expect(res.status).toBe(200);
    expect(((await (await call(client, "GET", "/api/auth/me")).json()) as { user: { theme: string } }).user.theme).toBe("dark");
  });

  it("rejects unknown themes and writes without the CSRF token", async () => {
    const client = await signedInClient();
    expect((await call(client, "PATCH", "/api/me/preferences", { theme: "sepia" })).status).toBe(400);
    expect((await call({ ...client, csrfToken: "wrong" }, "PATCH", "/api/me/preferences", { theme: "dark" })).status).toBe(403);
  });
});
