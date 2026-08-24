CREATE TABLE `exception_actions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alert_text` text NOT NULL,
	`operation_reference` text DEFAULT 'GBU002/26' NOT NULL,
	`responsible_name` text NOT NULL,
	`responsible_email` text NOT NULL,
	`due_date` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'Notificado' NOT NULL,
	`notified_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
