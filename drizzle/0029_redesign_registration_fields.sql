ALTER TABLE `suppliers` ADD `address` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `importer_clients` ADD `notify_party` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `importer_clients` ADD `preferred_incoterm` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `importer_clients` ADD `preferred_currency` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `master_products` ADD `sales_unit` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `master_products` ADD `packaging` text DEFAULT '' NOT NULL;
