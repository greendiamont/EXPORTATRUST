CREATE TABLE IF NOT EXISTS `export_milestones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer DEFAULT 1 NOT NULL,
	`operation_id` integer NOT NULL,
	`code` text NOT NULL,
	`sequence` integer NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'Pendente' NOT NULL,
	`quality_status` text DEFAULT 'Não iniciado' NOT NULL,
	`shipment_approval` text DEFAULT 'Não aplicável' NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `export_milestones_operation_code_idx` ON `export_milestones` (`operation_id`,`code`);
--> statement-breakpoint
ALTER TABLE `export_milestones` ADD `responsible_name` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `export_milestones` ADD `responsible_email` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `export_milestones` ADD `next_action` text DEFAULT '' NOT NULL;
