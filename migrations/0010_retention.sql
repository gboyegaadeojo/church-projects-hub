CREATE TABLE `data_deletion_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`requested_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` integer,
	`decided_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "data_deletion_requests_status_check" CHECK(status IN ('pending', 'approved', 'rejected', 'completed'))
);
--> statement-breakpoint
CREATE INDEX `data_deletion_requests_status_idx` ON `data_deletion_requests` (`status`,`requested_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `suspended_at` integer;--> statement-breakpoint
-- Anyone suspended before this column existed starts their six months from their last update.
UPDATE `users` SET `suspended_at` = `updated_at` WHERE `status` = 'suspended';