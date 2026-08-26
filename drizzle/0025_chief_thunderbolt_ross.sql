CREATE TABLE `gmail_oauth_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`client_id` text NOT NULL,
	`client_secret_encrypted` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_oauth_configs_organization_id_unique` ON `gmail_oauth_configs` (`organization_id`);