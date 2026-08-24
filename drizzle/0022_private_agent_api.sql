CREATE TABLE `agent_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer DEFAULT 1 NOT NULL,
	`credential_id` text NOT NULL,
	`name` text DEFAULT 'Agente Particular' NOT NULL,
	`token_hash` text NOT NULL,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'Ativo' NOT NULL,
	`last_four` text DEFAULT '' NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`last_used_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_credentials_credential_id_unique` ON `agent_credentials` (`credential_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_credentials_org_credential_idx` ON `agent_credentials` (`organization_id`,`credential_id`);
--> statement-breakpoint
CREATE TABLE `agent_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer DEFAULT 1 NOT NULL,
	`event_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text DEFAULT '' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`sender` text DEFAULT '' NOT NULL,
	`recipients_json` text DEFAULT '[]' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`matched_operation_id` integer,
	`match_confidence` text DEFAULT 'NONE' NOT NULL,
	`match_score` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Recebido' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`processed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`matched_operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_events_org_event_idx` ON `agent_events` (`organization_id`,`event_id`);
--> statement-breakpoint
CREATE TABLE `operation_timeline` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer DEFAULT 1 NOT NULL,
	`operation_id` integer NOT NULL,
	`event_type` text DEFAULT 'agent_event' NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'agent' NOT NULL,
	`external_event_id` text DEFAULT '' NOT NULL,
	`document_id` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_by` text DEFAULT 'Agente Particular' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `operation_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer DEFAULT 1 NOT NULL,
	`approval_id` text NOT NULL,
	`action_type` text NOT NULL,
	`operation_id` integer,
	`description` text NOT NULL,
	`proposed_action_json` text DEFAULT '{}' NOT NULL,
	`current_data_json` text DEFAULT '{}' NOT NULL,
	`proposed_data_json` text DEFAULT '{}' NOT NULL,
	`risk` text DEFAULT 'MEDIUM' NOT NULL,
	`requested_by` text DEFAULT 'Agente Particular' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`decided_by` text DEFAULT '' NOT NULL,
	`decided_at` text,
	`decision_note` text DEFAULT '' NOT NULL,
	`expires_at` text,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_approvals_approval_id_unique` ON `agent_approvals` (`approval_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_approvals_org_approval_idx` ON `agent_approvals` (`organization_id`,`approval_id`);
