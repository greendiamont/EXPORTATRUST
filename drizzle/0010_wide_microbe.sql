CREATE TABLE `agent_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`operation_id` integer NOT NULL,
	`stage_category` text NOT NULL,
	`requesting_agent` text DEFAULT 'supply-chain-orchestrator' NOT NULL,
	`provider_agent` text NOT NULL,
	`capability` text NOT NULL,
	`input_json` text DEFAULT '{}' NOT NULL,
	`document_ids_json` text DEFAULT '[]' NOT NULL,
	`candidate_scores_json` text DEFAULT '[]' NOT NULL,
	`expected_price` real DEFAULT 0 NOT NULL,
	`actual_price` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'Aguardando aprovação' NOT NULL,
	`result` text DEFAULT '' NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`approval_status` text DEFAULT 'Pendente' NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`logs_json` text DEFAULT '[]' NOT NULL,
	`output_document_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_jobs_job_id_unique` ON `agent_jobs` (`job_id`);--> statement-breakpoint
CREATE TABLE `agent_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`operation_id` integer NOT NULL,
	`client_name` text DEFAULT '' NOT NULL,
	`stage_category` text NOT NULL,
	`agent_id` text NOT NULL,
	`service_id` text NOT NULL,
	`entry_type` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`simulated` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_operation_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_id` integer NOT NULL,
	`autonomy_level` integer DEFAULT 1 NOT NULL,
	`transaction_limit` real DEFAULT 25 NOT NULL,
	`daily_limit` real DEFAULT 100 NOT NULL,
	`external_payments_enabled` integer DEFAULT false NOT NULL,
	`allowed_providers_json` text DEFAULT '[]' NOT NULL,
	`blocked_providers_json` text DEFAULT '[]' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_operation_settings_operation_id_unique` ON `agent_operation_settings` (`operation_id`);--> statement-breakpoint
CREATE TABLE `agent_reputation` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`capability` text NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`average_duration_ms` integer DEFAULT 0 NOT NULL,
	`quality_score` real DEFAULT 80 NOT NULL,
	`average_cost_variance_pct` real DEFAULT 0 NOT NULL,
	`average_confidence` real DEFAULT 0 NOT NULL,
	`human_validation_rate` real DEFAULT 0 NOT NULL,
	`rework_count` integer DEFAULT 0 NOT NULL,
	`later_divergence_count` integer DEFAULT 0 NOT NULL,
	`score` real DEFAULT 80 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_reputation_agent_capability_idx` ON `agent_reputation` (`agent_id`,`capability`);--> statement-breakpoint
CREATE TABLE `agent_services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`service_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`capabilities_json` text DEFAULT '[]' NOT NULL,
	`category` text NOT NULL,
	`provider` text NOT NULL,
	`adapter_type` text DEFAULT 'internal' NOT NULL,
	`endpoint` text DEFAULT 'internal://local' NOT NULL,
	`internal` integer DEFAULT true NOT NULL,
	`price` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`estimated_cost` real DEFAULT 0 NOT NULL,
	`average_response_ms` integer DEFAULT 1000 NOT NULL,
	`availability` real DEFAULT 100 NOT NULL,
	`reputation` real DEFAULT 80 NOT NULL,
	`execution_count` integer DEFAULT 0 NOT NULL,
	`success_rate` real DEFAULT 100 NOT NULL,
	`last_used_at` text,
	`status` text DEFAULT 'Ativo' NOT NULL,
	`financial_limit` real DEFAULT 25 NOT NULL,
	`requires_human_approval` integer DEFAULT true NOT NULL,
	`commercial` integer DEFAULT false NOT NULL,
	`input_description` text DEFAULT '' NOT NULL,
	`output_description` text DEFAULT '' NOT NULL,
	`sla` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_services_agent_id_unique` ON `agent_services` (`agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_services_service_id_unique` ON `agent_services` (`service_id`);