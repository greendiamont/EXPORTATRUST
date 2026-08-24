CREATE TABLE `shipment_advices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer DEFAULT 1 NOT NULL,
	`operation_id` integer NOT NULL,
	`status` text DEFAULT 'Rascunho' NOT NULL,
	`recipient` text DEFAULT '' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`payment_request` text DEFAULT 'Solicitar pagamento do saldo e comprovante SWIFT.' NOT NULL,
	`document_ids_json` text DEFAULT '[]' NOT NULL,
	`checklist_json` text DEFAULT '[]' NOT NULL,
	`human_approved` integer DEFAULT false NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` text,
	`sent_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shipment_advices_org_operation_idx` ON `shipment_advices` (`organization_id`,`operation_id`);--> statement-breakpoint
ALTER TABLE `operation_documents` ADD `source_system` text DEFAULT 'Upload manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `operation_documents` ADD `source_external_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `operation_documents` ADD `source_task_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `operation_documents` ADD `source_created_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `operation_documents` ADD `document_type` text DEFAULT 'Outro documento' NOT NULL;--> statement-breakpoint
ALTER TABLE `operation_documents` ADD `lifecycle_status` text DEFAULT 'Vigente' NOT NULL;--> statement-breakpoint
ALTER TABLE `operation_documents` ADD `shipment_set_status` text DEFAULT 'Fora do set' NOT NULL;--> statement-breakpoint
ALTER TABLE `operation_documents` ADD `client_share_status` text DEFAULT 'Interno' NOT NULL;--> statement-breakpoint
ALTER TABLE `operation_documents` ADD `analysis_summary` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `operation_documents` ADD `sha256` text DEFAULT '' NOT NULL;