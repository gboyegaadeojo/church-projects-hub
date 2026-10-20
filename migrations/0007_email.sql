CREATE TABLE `email_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`to_email` text,
	`template` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`dedupe_key` text,
	`mode` text DEFAULT 'instant' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`send_after` integer NOT NULL,
	`sent_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "email_outbox_status_check" CHECK(status IN ('pending', 'sent', 'failed', 'digested')),
	CONSTRAINT "email_outbox_mode_check" CHECK(mode IN ('instant', 'digest'))
);
--> statement-breakpoint
CREATE INDEX `email_outbox_status_send_after_idx` ON `email_outbox` (`status`,`send_after`);--> statement-breakpoint
CREATE INDEX `email_outbox_user_id_status_idx` ON `email_outbox` (`user_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_outbox_dedupe_key_idx` ON `email_outbox` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `email_outbox_sent_at_idx` ON `email_outbox` (`sent_at`);--> statement-breakpoint
CREATE TABLE `notification_prefs` (
	`user_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`mode` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` integer,
	PRIMARY KEY(`user_id`, `event_type`, `channel`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_prefs_mode_check" CHECK(mode IN ('instant', 'digest', 'off'))
);
