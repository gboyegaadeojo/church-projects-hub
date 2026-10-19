-- Task search (NAV-1, section 6): FTS5 index over key, title and body (description plus comment text).
-- rowid is the task id, so the Worker updates one row by primary key (worker/tasks/search.ts) instead of
-- scanning. project_id is stored, not indexed, so results can be filtered to the person's projects.
-- Prefix indexes for 2 and 3 characters make "as you type" prefix queries cheap (section 11.11).
CREATE VIRTUAL TABLE `tasks_fts` USING fts5(
	`project_id` UNINDEXED,
	`key`,
	`title`,
	`body`,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);
