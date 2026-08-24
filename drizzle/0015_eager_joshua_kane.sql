DROP INDEX `suppliers_tax_id_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_org_tax_id_idx` ON `suppliers` (`organization_id`,`tax_id`);