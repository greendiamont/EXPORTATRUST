CREATE TABLE IF NOT EXISTS `operation_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`operation_id` integer NOT NULL,
	`author_email` text NOT NULL,
	`author_name` text DEFAULT '' NOT NULL,
	`body` text NOT NULL,
	`mentions_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `operation_presence` (
	`organization_id` integer NOT NULL,
	`operation_id` integer NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`seen_at` text NOT NULL,
	PRIMARY KEY(`operation_id`, `email`)
);
