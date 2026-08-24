CREATE TABLE `operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reference` text NOT NULL,
	`product` text NOT NULL,
	`hs_code` text NOT NULL,
	`destination_country` text NOT NULL,
	`eu_importer` text NOT NULL,
	`supplier_id` integer,
	`supplier_name` text NOT NULL,
	`shipment_date` text DEFAULT '' NOT NULL,
	`readiness` integer DEFAULT 10 NOT NULL,
	`status` text DEFAULT 'Cadastro inicial' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operations_reference_unique` ON `operations` (`reference`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`legal_name` text NOT NULL,
	`trade_name` text DEFAULT '' NOT NULL,
	`tax_id` text NOT NULL,
	`country` text DEFAULT 'Brasil' NOT NULL,
	`state` text NOT NULL,
	`city` text NOT NULL,
	`contact_name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`certifications` text DEFAULT 'Sem certificação' NOT NULL,
	`status` text DEFAULT 'Em homologação' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_tax_id_unique` ON `suppliers` (`tax_id`);