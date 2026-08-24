CREATE TABLE `rural_properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`car_code` text NOT NULL,
	`name` text NOT NULL,
	`city` text NOT NULL,
	`supplier` text NOT NULL,
	`area_ha` real NOT NULL,
	`native_area_ha` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'Em análise' NOT NULL,
	`risk` text DEFAULT 'atenção' NOT NULL,
	`geometry_json` text NOT NULL,
	`source_file` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rural_properties_car_code_unique` ON `rural_properties` (`car_code`);