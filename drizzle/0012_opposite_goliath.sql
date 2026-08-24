CREATE TABLE `organizations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`tax_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Ativa' NOT NULL,
	`data_region` text DEFAULT 'global' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
INSERT OR IGNORE INTO `organizations` (`id`,`slug`,`name`,`tax_id`,`status`,`data_region`) VALUES (1,'exportatrust','ExportaTrust','','Ativa','global');--> statement-breakpoint
CREATE TABLE `app_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`full_name` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Ativo' NOT NULL,
	`identity_provider` text DEFAULT 'chatgpt-siwc' NOT NULL,
	`last_login_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_users_email_unique` ON `app_users` (`email`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`actor_user_id` integer,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text DEFAULT '' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`previous_hash` text DEFAULT 'GENESIS' NOT NULL,
	`event_hash` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_logs_event_hash_unique` ON `audit_logs` (`event_hash`);--> statement-breakpoint
CREATE TABLE `backup_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`object_key` text NOT NULL,
	`content_hash` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`status` text DEFAULT 'Concluído' NOT NULL,
	`triggered_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backup_snapshots_object_key_unique` ON `backup_snapshots` (`object_key`);--> statement-breakpoint
CREATE TABLE `document_access_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`document_type` text NOT NULL,
	`document_id` integer NOT NULL,
	`inline` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_access_tokens_token_hash_unique` ON `document_access_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `legal_acceptances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`document_type` text NOT NULL,
	`version` text NOT NULL,
	`accepted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_acceptances_user_doc_version_idx` ON `legal_acceptances` (`user_id`,`document_type`,`version`);--> statement-breakpoint
CREATE TABLE `organization_memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`role` text DEFAULT 'cliente' NOT NULL,
	`status` text DEFAULT 'Ativo' NOT NULL,
	`invited_by` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_memberships_org_user_idx` ON `organization_memberships` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `pdf_integrity_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`operation_id` integer,
	`property_car_code` text DEFAULT '' NOT NULL,
	`document_type` text NOT NULL,
	`file_name` text NOT NULL,
	`sha256` text NOT NULL,
	`generated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `agent_jobs` ADD `organization_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_ledger` ADD `organization_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `exception_actions` ADD `organization_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `forest_documents` ADD `organization_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `industrial_plans` ADD `organization_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `operation_documents` ADD `organization_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `operation_partners` ADD `organization_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `operations` ADD `organization_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_transactions` ADD `organization_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `rural_properties` ADD `organization_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `organization_id` integer DEFAULT 1 NOT NULL;
