CREATE TABLE `reply_review` (
	`message_id` text PRIMARY KEY NOT NULL,
	`generation` integer NOT NULL,
	`result_json` text NOT NULL,
	`confirmed_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `message`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `translation_job` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text NOT NULL,
	`target_language` text NOT NULL,
	`prompt_version` text NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result_json` text,
	`error_code` text,
	`provider_status` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`message_id`,`workspace_id`,`inbox_id`,`thread_id`) REFERENCES `message`(`id`,`workspace_id`,`inbox_id`,`thread_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translation_job_identity_uq` ON `translation_job` (`message_id`,`target_language`,`prompt_version`);--> statement-breakpoint
CREATE TABLE `translation_post` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`discord_message_id` text NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `translation_job`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `translation_post_chunk_uq` ON `translation_post` (`job_id`,`chunk_index`);--> statement-breakpoint
CREATE TABLE `translation_selection` (
	`interaction_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text NOT NULL,
	`target_language` text NOT NULL,
	FOREIGN KEY (`message_id`,`workspace_id`,`inbox_id`,`thread_id`) REFERENCES `message`(`id`,`workspace_id`,`inbox_id`,`thread_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `message` ADD `reply_translation` text;--> statement-breakpoint
ALTER TABLE `message` ADD `reply_translation_request` text;