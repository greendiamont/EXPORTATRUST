CREATE TABLE IF NOT EXISTS `finance_issuers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`name` text NOT NULL,
	`tax_id` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`bank` text DEFAULT '' NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
