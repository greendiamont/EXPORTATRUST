CREATE TABLE `system_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`level` text DEFAULT 'error' NOT NULL,
	`source` text NOT NULL,
	`fingerprint` text NOT NULL,
	`message` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'Aberto' NOT NULL,
	`occurred_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
