CREATE TABLE `operation_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_id` integer NOT NULL,
	`category` text NOT NULL,
	`file_name` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size_bytes` integer NOT NULL,
	`status` text DEFAULT 'Recebido' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`uploaded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_documents_object_key_unique` ON `operation_documents` (`object_key`);--> statement-breakpoint
CREATE TABLE `operation_partners` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_id` integer NOT NULL,
	`role` text NOT NULL,
	`company_name` text NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`country` text DEFAULT 'Brasil' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
