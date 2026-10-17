CREATE TABLE IF NOT EXISTS `shipment_report_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer NOT NULL,
	`client_key` text NOT NULL,
	`client_name` text DEFAULT '' NOT NULL,
	`emails` text DEFAULT '' NOT NULL,
	`auto` integer DEFAULT 0 NOT NULL,
	`interval_days` integer DEFAULT 10 NOT NULL,
	`on_phase_change` integer DEFAULT 1 NOT NULL,
	`include_payments` integer DEFAULT 1 NOT NULL,
	`last_sent_at` text DEFAULT '' NOT NULL,
	`last_phases_json` text DEFAULT '{}' NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `shipment_report_settings_org_client_idx` ON `shipment_report_settings` (`organization_id`, `client_key`);
