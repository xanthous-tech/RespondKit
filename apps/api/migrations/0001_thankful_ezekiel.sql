CREATE TABLE `customer` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`inbox_id`,`workspace_id`) REFERENCES `inbox`(`id`,`workspace_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_user_inbox_uq` ON `customer` (`workspace_id`,`inbox_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `customer_scope_uq` ON `customer` (`id`,`workspace_id`,`inbox_id`);--> statement-breakpoint
CREATE TABLE `visitor_alias` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitor`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visitor_alias_value_uq` ON `visitor_alias` (`visitor_id`,`kind`,`value`);--> statement-breakpoint
CREATE INDEX `visitor_alias_lookup_idx` ON `visitor_alias` (`kind`,`value`);--> statement-breakpoint
CREATE TABLE `visitor_customer` (
	`visitor_id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`linked_at` integer NOT NULL,
	FOREIGN KEY (`visitor_id`,`workspace_id`,`inbox_id`) REFERENCES `visitor`(`id`,`workspace_id`,`inbox_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`,`workspace_id`,`inbox_id`) REFERENCES `customer`(`id`,`workspace_id`,`inbox_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `visitor_customer_lookup_idx` ON `visitor_customer` (`customer_id`,`visitor_id`);--> statement-breakpoint
ALTER TABLE `visitor` ADD `session_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO visitor_alias (id, visitor_id, kind, value, first_seen_at, last_seen_at)
SELECT 'legacy_user_' || id, id, 'app_user_id', external_user_id, created_at, last_seen_at
FROM visitor WHERE external_user_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO visitor_alias (id, visitor_id, kind, value, first_seen_at, last_seen_at)
SELECT 'legacy_posthog_' || id, id, 'posthog_distinct_id', posthog_distinct_id, created_at, last_seen_at
FROM visitor WHERE posthog_distinct_id IS NOT NULL;
