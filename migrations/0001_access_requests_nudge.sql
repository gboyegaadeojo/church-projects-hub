ALTER TABLE `access_requests` ADD `last_nudged_at` integer;--> statement-breakpoint
CREATE INDEX `access_requests_user_id_created_at_idx` ON `access_requests` (`user_id`,`created_at`);