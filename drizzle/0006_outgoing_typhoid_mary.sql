CREATE TABLE `industrial_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_id` integer NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`receiving_lots` text DEFAULT '' NOT NULL,
	`opening_stock_kg` real DEFAULT 0 NOT NULL,
	`raw_material_received_kg` real DEFAULT 0 NOT NULL,
	`raw_material_consumed_kg` real DEFAULT 0 NOT NULL,
	`pellets_produced_kg` real DEFAULT 0 NOT NULL,
	`closing_stock_kg` real DEFAULT 0 NOT NULL,
	`production_lots` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Em elaboração' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `industrial_plans_operation_id_unique` ON `industrial_plans` (`operation_id`);