CREATE TABLE `releases_news` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`body_md` text NOT NULL,
	`published_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`created_by` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `releases_news_published_at_idx` ON `releases_news` (`published_at`);--> statement-breakpoint
CREATE TABLE `user_news_seen` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`last_news_id` integer NOT NULL,
	`seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
