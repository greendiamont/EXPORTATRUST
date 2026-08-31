CREATE TABLE `operation_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer DEFAULT 1 NOT NULL,
	`operation_id` integer NOT NULL,
	`parent_task_id` integer,
	`sequence` integer NOT NULL,
	`description` text NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`responsible_name` text DEFAULT '' NOT NULL,
	`responsible_email` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Pendente' NOT NULL,
	`scheduled` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operation_tasks_operation_sequence_idx` ON `operation_tasks` (`operation_id`,`sequence`);