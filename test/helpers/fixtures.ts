import { env } from "cloudflare:workers";
import type { ProjectRole } from "../../shared/access";
import { type Client, signedInClient } from "./auth";

// Real rows in the test D1 for permission and access tests. No real people's details (NFR-24).

let projectCounter = 0;

export async function createProject(
  opts: { name?: string; hidden?: boolean; isSystem?: boolean; archived?: boolean } = {},
): Promise<{ id: number; key: string; name: string }> {
  projectCounter += 1;
  const key = `T${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}${projectCounter}`;
  const name = opts.name ?? `Test project ${key}`;
  const row = await env.DB.prepare(
    `INSERT INTO projects (key, name, description, colour, icon, hidden, is_system, archived_at)
     VALUES (?1, ?2, 'Test project', 'blue', 'folder', ?3, ?4, ?5) RETURNING id`,
  )
    .bind(key, name, opts.hidden ? 1 : 0, opts.isSystem ? 1 : 0, opts.archived ? Date.now() : null)
    .first<{ id: number }>();
  return { id: row!.id, key, name };
}

export async function setUser(userId: number, fields: { status?: string; appRole?: string; timezone?: string }) {
  if (fields.status) await env.DB.prepare("UPDATE users SET status = ? WHERE id = ?").bind(fields.status, userId).run();
  if (fields.appRole) await env.DB.prepare("UPDATE users SET app_role = ? WHERE id = ?").bind(fields.appRole, userId).run();
  if (fields.timezone) await env.DB.prepare("UPDATE users SET timezone = ? WHERE id = ?").bind(fields.timezone, userId).run();
}

export async function addMember(projectId: number, userId: number, role: ProjectRole) {
  await env.DB.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)")
    .bind(projectId, userId, role)
    .run();
}

/** The five columns of the section 2 matrix. */
export const MATRIX_ROLES = ["appAdmin", "projectAdmin", "contributor", "viewer", "pending"] as const;
export type MatrixRole = (typeof MATRIX_ROLES)[number];

/** A signed-in person holding one matrix role on `projectId` (Members for the project roles). */
export async function actorAs(role: MatrixRole, projectId: number, opts: { email?: string } = {}): Promise<Client> {
  const client = await signedInClient({ name: `Test ${role}`, email: opts.email });
  if (role === "pending") return client;
  await setUser(client.userId, { status: "active", appRole: role === "appAdmin" ? "admin" : "member" });
  if (role === "projectAdmin") await addMember(projectId, client.userId, "admin");
  if (role === "contributor") await addMember(projectId, client.userId, "contributor");
  if (role === "viewer") await addMember(projectId, client.userId, "viewer");
  return client;
}

export async function auditFor(action: string, targetId: number | string) {
  const { results } = await env.DB.prepare("SELECT * FROM audit_log WHERE action = ? AND target_id = ? ORDER BY id")
    .bind(action, String(targetId))
    .all<Record<string, unknown>>();
  return results.map((r) => ({ ...r, detail: JSON.parse(r.detail_json as string) as Record<string, unknown> }));
}
