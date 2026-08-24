CREATE TABLE `payment_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_id` text NOT NULL,
	`operation_id` integer,
	`job_id` text DEFAULT '' NOT NULL,
	`provider` text NOT NULL,
	`method` text NOT NULL,
	`direction` text NOT NULL,
	`catalog_key` text DEFAULT '' NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'BRL' NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`external_reference` text DEFAULT '' NOT NULL,
	`checkout_url` text DEFAULT '' NOT NULL,
	`simulated` integer DEFAULT true NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`settled_at` text,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_transactions_payment_id_unique` ON `payment_transactions` (`payment_id`);