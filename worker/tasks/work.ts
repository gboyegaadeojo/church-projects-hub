import { Hono } from "hono";
import { parseTaskKey } from "../../shared/tasks";
import { ftsQuery, SEARCH_MAX_QUERY, type SearchResponse, type WorkResponse, type WorkTask } from "../../shared/work";
import { forbidden } from "../auth/authorize";
import { requireSession } from "../auth/middleware";
import type { AppEnv } from "../types";

// My Work (NAV-3) and global search (NAV-1). Both are filtered to the projects the person can see in the same
// query (section 2): their memberships, or every project for App Admins; Hub Feedback only for App Admins.

/** Binds ?1 = user id, ?2 = 1 for App Admins. Matches live, visible projects aliased `p`. */
const VISIBLE = `p.deleted_at IS NULL AND (?2 = 1 OR (p.is_system = 0 AND EXISTS (
  SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = ?1)))`;

const TASK_COLUMNS = `t.id, p.key || '-' || t.number AS key, t.title, t.type, t.priority, t.due_date, s.name AS state_name,
  p.key AS project_key, p.name AS project_name, p.colour, p.icon`;

type TaskRow = {
  id: number;
  key: string;
  title: string;
  type: WorkTask["type"];
  priority: WorkTask["priority"];
  due_date: string | null;
  state_name: string;
  project_key: string;
  project_name: string;
  colour: WorkTask["project"]["colour"];
  icon: WorkTask["project"]["icon"];
};

const toWorkTask = (r: TaskRow): WorkTask => ({
  id: r.id,
  key: r.key,
  title: r.title,
  type: r.type,
  priority: r.priority,
  dueDate: r.due_date,
  stateName: r.state_name,
  project: { key: r.project_key, name: r.project_name, colour: r.colour, icon: r.icon },
});

export function workRoutes() {
  const routes = new Hono<AppEnv>();

  routes.get("/me/work", requireSession, async (c) => {
    const { user } = c.get("auth");
    if (user.status !== "active") return forbidden(c, 403);
    const admin = user.appRole === "admin" ? 1 : 0;
    const [tasks, mentions] = await c.env.DB.batch([
      // Open work: not in a Done column, in a project that isn't archived. Uses tasks (assignee_id, due_date).
      c.env.DB.prepare(
        `SELECT ${TASK_COLUMNS} FROM tasks t
         JOIN projects p ON p.id = t.project_id JOIN workflow_states s ON s.id = t.state_id
         WHERE t.assignee_id = ?1 AND t.deleted_at IS NULL AND s.category != 'done' AND p.archived_at IS NULL AND ${VISIBLE}
         ORDER BY t.due_date IS NULL, t.due_date, t.updated_at DESC LIMIT 200`,
      ).bind(user.id, admin),
      c.env.DB.prepare(
        `SELECT mn.id, p.key || '-' || t.number AS task_key, t.title, p.key AS project_key, u.name AS by_name,
                mn.created_at, mn.comment_id IS NOT NULL AS in_comment
         FROM mentions mn JOIN tasks t ON t.id = mn.task_id JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = mn.created_by
         WHERE mn.user_id = ?1 AND mn.seen_at IS NULL AND t.deleted_at IS NULL AND ${VISIBLE}
         ORDER BY mn.created_at DESC LIMIT 10`,
      ).bind(user.id, admin),
    ]);
    const body: WorkResponse = {
      tasks: (tasks!.results as TaskRow[]).map(toWorkTask),
      mentions: (
        mentions!.results as { id: number; task_key: string; title: string; project_key: string; by_name: string | null; created_at: number; in_comment: number }[]
      ).map((m) => ({
        id: m.id,
        taskKey: m.task_key,
        taskTitle: m.title,
        projectKey: m.project_key,
        by: m.by_name ?? "Someone",
        at: m.created_at,
        inComment: m.in_comment === 1,
      })),
    };
    return c.json(body);
  });

  // Section 11.11: prefix matching on key, title, description and comments, ranked by relevance then recency.
  routes.get("/search", requireSession, async (c) => {
    const { user } = c.get("auth");
    if (user.status !== "active") return forbidden(c, 403);
    const raw = (c.req.query("q") ?? "").trim().slice(0, SEARCH_MAX_QUERY);
    const admin = user.appRole === "admin" ? 1 : 0;
    const empty: SearchResponse = { exact: null, tasks: [], projects: [] };
    if (raw.length < 2) return c.json(empty);

    const key = parseTaskKey(raw);
    const match = ftsQuery(raw);
    const db = c.env.DB;
    const statements = [
      db
        .prepare(
          `SELECT key, name, colour, icon FROM projects p
           WHERE ${VISIBLE} AND (p.name LIKE ?3 ESCAPE '\\' OR p.key LIKE ?3 ESCAPE '\\') ORDER BY p.name COLLATE NOCASE LIMIT 5`,
        )
        .bind(user.id, admin, `%${raw.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`),
      key
        ? db
            .prepare(
              `SELECT ${TASK_COLUMNS} FROM tasks t JOIN projects p ON p.id = t.project_id JOIN workflow_states s ON s.id = t.state_id
               WHERE p.key = ?3 AND t.number = ?4 AND t.deleted_at IS NULL AND ${VISIBLE}`,
            )
            .bind(user.id, admin, key.projectKey, key.number)
        : db.prepare("SELECT NULL AS id WHERE 0"),
      match
        ? db
            .prepare(
              `SELECT ${TASK_COLUMNS}, snippet(tasks_fts, 3, '', '', '…', 12) AS snippet
               FROM tasks_fts f JOIN tasks t ON t.id = f.rowid JOIN projects p ON p.id = t.project_id
               JOIN workflow_states s ON s.id = t.state_id
               WHERE tasks_fts MATCH ?3 AND t.deleted_at IS NULL AND ${VISIBLE}
               ORDER BY bm25(tasks_fts, 0, 10.0, 5.0, 1.0), t.updated_at DESC LIMIT 20`,
            )
            .bind(user.id, admin, match)
        : db.prepare("SELECT NULL AS id WHERE 0"),
    ];
    const [projects, exact, tasks] = await db.batch(statements);
    const body: SearchResponse = {
      exact: ((exact!.results as TaskRow[])[0] && toWorkTask((exact!.results as TaskRow[])[0]!)) || null,
      tasks: (tasks!.results as (TaskRow & { snippet: string })[]).filter((r) => r.id !== null).map((r) => ({ ...toWorkTask(r), snippet: r.snippet ?? "" })),
      projects: projects!.results as SearchResponse["projects"],
    };
    return c.json(body);
  });

  return routes;
}
