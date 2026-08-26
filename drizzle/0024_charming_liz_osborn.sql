CREATE TABLE `gmail_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`gmail_address` text DEFAULT '' NOT NULL,
	`access_token_encrypted` text DEFAULT '' NOT NULL,
	`refresh_token_encrypted` text DEFAULT '' NOT NULL,
	`access_token_expires_at` text,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`history_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Ativo' NOT NULL,
	`last_sync_at` text,
	`last_error` text DEFAULT '' NOT NULL,
	`connected_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_connections_org_user_idx` ON `gmail_connections` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `google_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`organization_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
