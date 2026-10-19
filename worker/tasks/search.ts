// Keeping tasks_fts (migrations/0003_tasks_search.sql) in step with tasks and comments (NAV-1, section 6).
// Its rowid is the task id, so each refresh replaces one row by primary key. Add these statements to the
// same batch as the change they reflect.

/** Re-indexes one task (bind ?1 = task id); removes it when the task is deleted. */
const REFRESH_SQL = `
  INSERT OR REPLACE INTO tasks_fts (rowid, project_id, key, title, body)
  SELECT t.id, t.project_id, p.key || '-' || t.number, t.title,
         t.description_text || char(10) || coalesce(
           (SELECT group_concat(c.body_text, char(10)) FROM comments c WHERE c.task_id = t.id AND c.deleted_at IS NULL), '')
  FROM tasks t JOIN projects p ON p.id = t.project_id
  WHERE t.id = ?1 AND t.deleted_at IS NULL`;

export function refreshSearch(env: Env, taskId: number) {
  return env.DB.prepare(REFRESH_SQL).bind(taskId);
}

/** For a task inserted earlier in the same batch: `idSql` is a subquery that finds its id. */
export function refreshSearchFor(env: Env, idSql: string, ...bind: unknown[]) {
  return env.DB.prepare(REFRESH_SQL.replace("t.id = ?1", `t.id = ${idSql}`)).bind(...bind);
}

export function removeFromSearch(env: Env, taskId: number) {
  return env.DB.prepare("DELETE FROM tasks_fts WHERE rowid = ?1").bind(taskId);
}

/**
 * Rebuilds the whole index. Used after restoring a backup: `wrangler d1 export` can't export FTS5 tables,
 * so the nightly backup leaves tasks_fts out (README, Restoring). Same SQL as scripts/rebuild-search.sql.
 */
export const REBUILD_SEARCH_SQL = [
  "DELETE FROM tasks_fts",
  REFRESH_SQL.replace("WHERE t.id = ?1 AND t.deleted_at IS NULL", "WHERE t.deleted_at IS NULL").trim(),
];
