CREATE TABLE `product_traceability_catalog` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`organization_id` integer DEFAULT 1 NOT NULL,
	`product` text NOT NULL,
	`entry_type` text NOT NULL,
	`value` text NOT NULL,
	`scientific_name` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_traceability_catalog_org_product_type_value_idx` ON `product_traceability_catalog` (`organization_id`,`product`,`entry_type`,`value`);
