ALTER TABLE `tasks` ADD `blocked_reason` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `blocked_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `blocked_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `workflow_states` ADD `blocks` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- v4.7: every project gets a "Blocked" column right after its last in-progress column, if it has room (PROJ-3: at
-- most 8 columns) and doesn't have a blocking column yet. Later columns shift one place right to make room.
UPDATE `workflow_states` SET `position` = `position` + 1
WHERE `project_id` IN (
  SELECT p.`id` FROM `projects` p
  WHERE p.`deleted_at` IS NULL
    AND (SELECT count(*) FROM `workflow_states` s WHERE s.`project_id` = p.`id`) < 8
    AND EXISTS (SELECT 1 FROM `workflow_states` s WHERE s.`project_id` = p.`id` AND s.`category` = 'in_progress')
    AND NOT EXISTS (SELECT 1 FROM `workflow_states` s WHERE s.`project_id` = p.`id` AND s.`blocks` = 1)
)
AND `position` > (SELECT max(s2.`position`) FROM `workflow_states` s2 WHERE s2.`project_id` = `workflow_states`.`project_id` AND s2.`category` = 'in_progress');
--> statement-breakpoint
INSERT INTO `workflow_states` (`project_id`, `name`, `category`, `position`, `blocks`)
SELECT p.`id`, 'Blocked', 'in_progress',
       (SELECT max(s.`position`) FROM `workflow_states` s WHERE s.`project_id` = p.`id` AND s.`category` = 'in_progress') + 1,
       1
FROM `projects` p
WHERE p.`deleted_at` IS NULL
  AND (SELECT count(*) FROM `workflow_states` s WHERE s.`project_id` = p.`id`) < 8
  AND EXISTS (SELECT 1 FROM `workflow_states` s WHERE s.`project_id` = p.`id` AND s.`category` = 'in_progress')
  AND NOT EXISTS (SELECT 1 FROM `workflow_states` s WHERE s.`project_id` = p.`id` AND s.`blocks` = 1);
