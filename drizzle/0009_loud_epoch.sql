CREATE TABLE `forest_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_car_code` text NOT NULL,
	`category` text NOT NULL,
	`file_name` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size_bytes` integer NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'Fornecido pelo responsável' NOT NULL,
	`uploaded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`property_car_code`) REFERENCES `rural_properties`(`car_code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forest_documents_object_key_unique` ON `forest_documents` (`object_key`);