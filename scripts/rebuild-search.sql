-- Rebuilds the task search index (tasks_fts) from tasks and comments.
-- Run after restoring a nightly export, which leaves tasks_fts out because `wrangler d1 export` can't export
-- FTS5 tables (README, Restoring):
--   npx wrangler d1 execute <database> --remote --file scripts/rebuild-search.sql
-- Safe to run any time. Keep in step with migrations/0003_tasks_search.sql and worker/tasks/search.ts.
CREATE VIRTUAL TABLE IF NOT EXISTS `tasks_fts` USING fts5(
	`project_id` UNINDEXED,
	`key`,
	`title`,
	`body`,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);
DELETE FROM tasks_fts;
INSERT OR REPLACE INTO tasks_fts (rowid, project_id, key, title, body)
  SELECT t.id, t.project_id, p.key || '-' || t.number, t.title,
         t.description_text || char(10) || coalesce(
           (SELECT group_concat(c.body_text, char(10)) FROM comments c WHERE c.task_id = t.id AND c.deleted_at IS NULL), '')
  FROM tasks t JOIN projects p ON p.id = t.project_id
  WHERE t.deleted_at IS NULL;
