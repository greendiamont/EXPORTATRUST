CREATE TABLE `asana_import_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer DEFAULT 1 NOT NULL,
	`source_project_id` text NOT NULL,
	`source_project_name` text DEFAULT 'VLP EXPORTAÇÃO' NOT NULL,
	`task_gid` text NOT NULL,
	`parent_task_gid` text DEFAULT '' NOT NULL,
	`name` text NOT NULL,
	`section_name` text DEFAULT '' NOT NULL,
	`assignee_name` text DEFAULT '' NOT NULL,
	`assignee_email` text DEFAULT '' NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`source_status` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`source_url` text DEFAULT '' NOT NULL,
	`modified_at` text DEFAULT '' NOT NULL,
	`proposed_milestone_code` text DEFAULT '' NOT NULL,
	`attention_reasons_json` text DEFAULT '[]' NOT NULL,
	`import_status` text DEFAULT 'Aguardando revisão' NOT NULL,
	`matched_operation_id` integer,
	`reviewed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`matched_operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asana_import_candidates_org_project_task_idx` ON `asana_import_candidates` (`organization_id`,`source_project_id`,`task_gid`);