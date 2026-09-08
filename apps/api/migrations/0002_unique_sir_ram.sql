ALTER TABLE `thread` ADD `customer_read_cursor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `discord_message` ADD `read_reaction_at` integer;--> statement-breakpoint
ALTER TABLE `discord_message` ADD `read_reaction_retry_at` integer;