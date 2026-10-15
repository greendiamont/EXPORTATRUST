ALTER TABLE `operation_comments` ADD COLUMN `target_key` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `operation_presence` ADD COLUMN `editing` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `operation_followers` (
	`organization_id` integer NOT NULL,
	`operation_id` integer NOT NULL,
	`email` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`operation_id`, `email`)
);
