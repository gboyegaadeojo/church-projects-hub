CREATE TABLE `app_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`section` text,
	`request_id` text NOT NULL,
	`ip_hash` text,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `app_errors_at_idx` ON `app_errors` (`at`);