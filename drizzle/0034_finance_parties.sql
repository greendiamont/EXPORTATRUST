ALTER TABLE `finance_issuers` ADD COLUMN `kind` text DEFAULT 'issuer' NOT NULL;
--> statement-breakpoint
ALTER TABLE `finance_issuers` ADD COLUMN `details_json` text DEFAULT '{}' NOT NULL;
