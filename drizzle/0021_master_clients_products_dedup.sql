CREATE TABLE `importer_clients` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `organization_id` integer DEFAULT 1 NOT NULL,
  `legal_name` text NOT NULL, `normalized_name` text NOT NULL, `aliases` text DEFAULT '' NOT NULL,
  `tax_id` text DEFAULT '' NOT NULL, `tax_id_type` text DEFAULT 'VAT' NOT NULL, `eori` text DEFAULT '' NOT NULL,
  `address` text DEFAULT '' NOT NULL, `city` text DEFAULT '' NOT NULL, `state` text DEFAULT '' NOT NULL,
  `postal_code` text DEFAULT '' NOT NULL, `country` text NOT NULL, `contact_name` text DEFAULT '' NOT NULL,
  `email` text DEFAULT '' NOT NULL, `phone` text DEFAULT '' NOT NULL, `preferred_port` text DEFAULT '' NOT NULL,
  `payment_terms` text DEFAULT '' NOT NULL, `document_requirements` text DEFAULT '' NOT NULL,
  `data_status` text DEFAULT 'Pendente' NOT NULL, `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `importer_clients_org_normalized_idx` ON `importer_clients` (`organization_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `master_products` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `organization_id` integer DEFAULT 1 NOT NULL,
  `name` text NOT NULL, `normalized_name` text NOT NULL, `raw_material` text DEFAULT '' NOT NULL,
  `species` text DEFAULT '' NOT NULL, `scientific_name` text DEFAULT '' NOT NULL, `hs_code` text DEFAULT '' NOT NULL,
  `dimensional_specification` text DEFAULT '' NOT NULL, `grade` text DEFAULT '' NOT NULL,
  `kd` integer DEFAULT false NOT NULL, `ht` integer DEFAULT false NOT NULL, `moisture` text DEFAULT '' NOT NULL,
  `certifications` text DEFAULT '' NOT NULL, `origin_type` text DEFAULT 'Reflorestamento' NOT NULL,
  `eligible_supplier_ids` text DEFAULT '[]' NOT NULL, `data_status` text DEFAULT 'Pendente' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL, `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `master_products_org_normalized_idx` ON `master_products` (`organization_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `deduplication_queue` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `organization_id` integer DEFAULT 1 NOT NULL,
  `entity_type` text NOT NULL, `primary_record_id` integer NOT NULL, `possible_duplicate_id` integer NOT NULL,
  `reason` text NOT NULL, `confidence` real DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'Possível duplicidade' NOT NULL, `resolution_note` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `dedupe_queue_unique_pair_idx` ON `deduplication_queue` (`organization_id`,`entity_type`,`primary_record_id`,`possible_duplicate_id`);--> statement-breakpoint
ALTER TABLE `operations` ADD `importer_client_id` integer REFERENCES importer_clients(id);--> statement-breakpoint
ALTER TABLE `operations` ADD `master_product_id` integer REFERENCES master_products(id);--> statement-breakpoint
INSERT OR IGNORE INTO `importer_clients` (`organization_id`,`legal_name`,`normalized_name`,`country`,`preferred_port`,`eori`,`data_status`)
SELECT `organization_id`, trim(`eu_importer`), lower(trim(`eu_importer`)), max(`destination_country`), max(`port_of_discharge`), max(`eu_operator_eori`), 'Importado'
FROM `operations` WHERE trim(`eu_importer`) <> '' GROUP BY `organization_id`, lower(trim(`eu_importer`));--> statement-breakpoint
INSERT OR IGNORE INTO `master_products` (`organization_id`,`name`,`normalized_name`,`raw_material`,`species`,`hs_code`,`origin_type`,`data_status`)
SELECT `organization_id`, trim(`product`), lower(trim(`product`)), max(`raw_material`), max(`species`), max(`hs_code`), max(`forest_origin_type`), 'Importado'
FROM `operations` WHERE trim(`product`) <> '' GROUP BY `organization_id`, lower(trim(`product`));--> statement-breakpoint
UPDATE `operations` SET `importer_client_id` = (SELECT `id` FROM `importer_clients` c WHERE c.`organization_id` = `operations`.`organization_id` AND c.`normalized_name` = lower(trim(`operations`.`eu_importer`)) LIMIT 1);--> statement-breakpoint
UPDATE `operations` SET `master_product_id` = (SELECT `id` FROM `master_products` p WHERE p.`organization_id` = `operations`.`organization_id` AND p.`normalized_name` = lower(trim(`operations`.`product`)) LIMIT 1);
