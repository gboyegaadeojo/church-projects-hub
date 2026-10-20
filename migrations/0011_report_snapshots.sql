CREATE TABLE `report_snapshots` (
	`project_id` integer NOT NULL,
	`period` text NOT NULL,
	`metrics_json` text DEFAULT '{}' NOT NULL,
	`last_event_id` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` integer,
	PRIMARY KEY(`project_id`, `period`),
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
