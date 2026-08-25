CREATE TABLE `allowed_origin` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`origin` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`inbox_id`,`workspace_id`) REFERENCES `inbox`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "allowed_origin_origin_length_ck" CHECK(length("allowed_origin"."origin") between 8 and 2048)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `allowed_origin_inbox_origin_uq` ON `allowed_origin` (`workspace_id`,`inbox_id`,`origin`);--> statement-breakpoint
CREATE INDEX `allowed_origin_inbox_idx` ON `allowed_origin` (`workspace_id`,`inbox_id`);--> statement-breakpoint
CREATE TABLE `inbox` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`default_locale` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`,`workspace_id`) REFERENCES `product`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inbox_name_length_ck" CHECK(length("inbox"."name") between 1 and 160),
	CONSTRAINT "inbox_status_ck" CHECK("inbox"."status" in ('active', 'disabled')),
	CONSTRAINT "inbox_default_locale_length_ck" CHECK("inbox"."default_locale" is null or length("inbox"."default_locale") between 2 and 35)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_id_workspace_uq` ON `inbox` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `inbox_product_idx` ON `inbox` (`workspace_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `product` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_slug_length_ck" CHECK(length("product"."slug") between 1 and 80),
	CONSTRAINT "product_name_length_ck" CHECK(length("product"."name") between 1 and 160)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_workspace_slug_uq` ON `product` (`workspace_id`,`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_id_workspace_uq` ON `product` (`id`,`workspace_id`);--> statement-breakpoint
CREATE INDEX `product_workspace_idx` ON `product` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `visitor` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`external_user_id` text,
	`email` text,
	`posthog_distinct_id` text,
	`locale` text,
	`timezone` text,
	`region` text,
	`user_agent` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`inbox_id`,`workspace_id`) REFERENCES `inbox`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "visitor_installation_id_length_ck" CHECK(length("visitor"."installation_id") between 1 and 128),
	CONSTRAINT "visitor_external_user_id_length_ck" CHECK("visitor"."external_user_id" is null or length("visitor"."external_user_id") between 1 and 512),
	CONSTRAINT "visitor_email_length_ck" CHECK("visitor"."email" is null or length("visitor"."email") between 3 and 320),
	CONSTRAINT "visitor_posthog_id_length_ck" CHECK("visitor"."posthog_distinct_id" is null or length("visitor"."posthog_distinct_id") between 1 and 512),
	CONSTRAINT "visitor_locale_length_ck" CHECK("visitor"."locale" is null or length("visitor"."locale") between 2 and 35),
	CONSTRAINT "visitor_timezone_length_ck" CHECK("visitor"."timezone" is null or length("visitor"."timezone") between 1 and 64),
	CONSTRAINT "visitor_region_length_ck" CHECK("visitor"."region" is null or length("visitor"."region") between 2 and 80),
	CONSTRAINT "visitor_user_agent_length_ck" CHECK("visitor"."user_agent" is null or length("visitor"."user_agent") between 1 and 1024),
	CONSTRAINT "visitor_metadata_length_ck" CHECK(length("visitor"."metadata") <= 16384)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visitor_id_workspace_inbox_uq` ON `visitor` (`id`,`workspace_id`,`inbox_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `visitor_installation_inbox_uq` ON `visitor` (`workspace_id`,`inbox_id`,`installation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `visitor_external_user_inbox_uq` ON `visitor` (`workspace_id`,`inbox_id`,`external_user_id`);--> statement-breakpoint
CREATE INDEX `visitor_inbox_last_seen_idx` ON `visitor` (`workspace_id`,`inbox_id`,`last_seen_at`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "workspace_slug_length_ck" CHECK(length("workspace"."slug") between 1 and 80),
	CONSTRAINT "workspace_name_length_ck" CHECK(length("workspace"."name") between 1 and 160),
	CONSTRAINT "workspace_status_ck" CHECK("workspace"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_slug_uq` ON `workspace` (`slug`);--> statement-breakpoint
CREATE TABLE `message_translation` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text NOT NULL,
	`source_language` text NOT NULL,
	`target_language` text NOT NULL,
	`translated_text` text NOT NULL,
	`prompt_version` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`is_pass_through` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`message_id`,`workspace_id`,`inbox_id`,`thread_id`) REFERENCES `message`(`id`,`workspace_id`,`inbox_id`,`thread_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_translation_source_language_length_ck" CHECK(length("message_translation"."source_language") between 2 and 35),
	CONSTRAINT "message_translation_target_language_length_ck" CHECK(length("message_translation"."target_language") between 2 and 35),
	CONSTRAINT "message_translation_text_length_ck" CHECK(length("message_translation"."translated_text") between 1 and 6000),
	CONSTRAINT "message_translation_prompt_version_length_ck" CHECK(length("message_translation"."prompt_version") between 1 and 80),
	CONSTRAINT "message_translation_provider_length_ck" CHECK(length("message_translation"."provider") between 1 and 80),
	CONSTRAINT "message_translation_model_length_ck" CHECK(length("message_translation"."model") between 1 and 160)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_translation_identity_uq` ON `message_translation` (`message_id`,`target_language`,`prompt_version`);--> statement-breakpoint
CREATE INDEX `message_translation_message_idx` ON `message_translation` (`workspace_id`,`thread_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `message` (
	`row_id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`client_message_id` text,
	`workflow_instance_id` text NOT NULL,
	`direction` text NOT NULL,
	`original_text` text NOT NULL,
	`original_language` text,
	`customer_visible_text` text,
	`customer_visible_language` text,
	`operator_visible_text` text,
	`accepted_at` integer NOT NULL,
	`processing_generation` integer DEFAULT 1 NOT NULL,
	`processing_status` text DEFAULT 'processing' NOT NULL,
	`customer_availability` text DEFAULT 'pending' NOT NULL,
	`operator_projection_status` text DEFAULT 'not_applicable' NOT NULL,
	`discord_audit_status` text DEFAULT 'not_applicable' NOT NULL,
	`failure_stage` text,
	`failure_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`thread_id`,`workspace_id`,`inbox_id`) REFERENCES `thread`(`id`,`workspace_id`,`inbox_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "message_direction_ck" CHECK("message"."direction" in ('customer_to_operator', 'operator_to_customer')),
	CONSTRAINT "message_original_text_length_ck" CHECK(length("message"."original_text") between 1 and 6000),
	CONSTRAINT "message_customer_text_length_ck" CHECK("message"."customer_visible_text" is null or length("message"."customer_visible_text") between 1 and 6000),
	CONSTRAINT "message_operator_text_length_ck" CHECK("message"."operator_visible_text" is null or length("message"."operator_visible_text") between 1 and 6000),
	CONSTRAINT "message_original_language_length_ck" CHECK("message"."original_language" is null or length("message"."original_language") between 2 and 35),
	CONSTRAINT "message_customer_language_length_ck" CHECK("message"."customer_visible_language" is null or length("message"."customer_visible_language") between 2 and 35),
	CONSTRAINT "message_generation_ck" CHECK("message"."processing_generation" >= 1),
	CONSTRAINT "message_processing_status_ck" CHECK("message"."processing_status" in ('processing', 'retrying', 'succeeded', 'failed')),
	CONSTRAINT "message_customer_availability_ck" CHECK("message"."customer_availability" in ('pending', 'available', 'not_available')),
	CONSTRAINT "message_operator_projection_status_ck" CHECK("message"."operator_projection_status" in ('pending', 'projected', 'failed', 'not_applicable')),
	CONSTRAINT "message_discord_audit_status_ck" CHECK("message"."discord_audit_status" in ('pending', 'projected', 'failed', 'not_applicable')),
	CONSTRAINT "message_failure_stage_ck" CHECK("message"."failure_stage" is null or "message"."failure_stage" in ('ingress', 'translation', 'publish', 'discord_thread', 'discord_projection', 'discord_audit')),
	CONSTRAINT "message_failure_code_length_ck" CHECK("message"."failure_code" is null or length("message"."failure_code") between 1 and 128),
	CONSTRAINT "message_client_id_direction_ck" CHECK(("message"."direction" = 'customer_to_operator' and "message"."client_message_id" is not null)
        or ("message"."direction" = 'operator_to_customer' and "message"."client_message_id" is null)),
	CONSTRAINT "message_initial_visibility_ck" CHECK("message"."direction" != 'customer_to_operator' or "message"."customer_visible_text" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_id_uq` ON `message` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_workflow_instance_uq` ON `message` (`workflow_instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_thread_client_id_uq` ON `message` (`workspace_id`,`thread_id`,`client_message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `message_id_scope_uq` ON `message` (`id`,`workspace_id`,`inbox_id`,`thread_id`);--> statement-breakpoint
CREATE INDEX `message_thread_cursor_idx` ON `message` (`workspace_id`,`thread_id`,`row_id`);--> statement-breakpoint
CREATE INDEX `message_thread_display_idx` ON `message` (`workspace_id`,`thread_id`,`accepted_at`,`id`);--> statement-breakpoint
CREATE INDEX `message_processing_idx` ON `message` (`workspace_id`,`processing_status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `thread` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`client_thread_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`customer_language` text,
	`customer_language_updated_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_activity_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`inbox_id`,`workspace_id`) REFERENCES `inbox`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`visitor_id`,`workspace_id`,`inbox_id`) REFERENCES `visitor`(`id`,`workspace_id`,`inbox_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_status_ck" CHECK("thread"."status" in ('open', 'closed')),
	CONSTRAINT "thread_client_id_length_ck" CHECK(length("thread"."client_thread_id") between 1 and 128),
	CONSTRAINT "thread_customer_language_length_ck" CHECK("thread"."customer_language" is null or length("thread"."customer_language") between 2 and 35)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_id_workspace_inbox_uq` ON `thread` (`id`,`workspace_id`,`inbox_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `thread_client_id_visitor_uq` ON `thread` (`workspace_id`,`inbox_id`,`visitor_id`,`client_thread_id`);--> statement-breakpoint
CREATE INDEX `thread_visitor_activity_idx` ON `thread` (`workspace_id`,`inbox_id`,`visitor_id`,`last_activity_at`);--> statement-breakpoint
CREATE INDEX `thread_inbox_activity_idx` ON `thread` (`workspace_id`,`inbox_id`,`last_activity_at`);--> statement-breakpoint
CREATE TABLE `discord_integration` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`application_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`forum_channel_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`inbox_id`,`workspace_id`) REFERENCES `inbox`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "discord_integration_application_id_ck" CHECK(length("discord_integration"."application_id") between 1 and 32),
	CONSTRAINT "discord_integration_guild_id_ck" CHECK(length("discord_integration"."guild_id") between 1 and 32),
	CONSTRAINT "discord_integration_forum_id_ck" CHECK(length("discord_integration"."forum_channel_id") between 1 and 32)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_integration_inbox_uq` ON `discord_integration` (`workspace_id`,`inbox_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `discord_integration_destination_uq` ON `discord_integration` (`application_id`,`guild_id`,`forum_channel_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `discord_integration_id_workspace_uq` ON `discord_integration` (`id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `discord_integration_id_scope_uq` ON `discord_integration` (`id`,`workspace_id`,`inbox_id`);--> statement-breakpoint
CREATE TABLE `discord_interaction` (
	`integration_id` text NOT NULL,
	`interaction_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text,
	`application_id` text NOT NULL,
	`guild_id` text NOT NULL,
	`discord_thread_id` text NOT NULL,
	`operator_user_id` text NOT NULL,
	`operator_role_ids` text DEFAULT '[]' NOT NULL,
	`command_name` text NOT NULL,
	`reference_interaction_id` text,
	`normalized_message` text,
	`accepted_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`integration_id`, `interaction_id`),
	FOREIGN KEY (`integration_id`,`workspace_id`,`inbox_id`) REFERENCES `discord_integration`(`id`,`workspace_id`,`inbox_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`,`workspace_id`,`inbox_id`) REFERENCES `thread`(`id`,`workspace_id`,`inbox_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`,`workspace_id`,`inbox_id`,`integration_id`,`discord_thread_id`) REFERENCES `discord_thread`(`thread_id`,`workspace_id`,`inbox_id`,`integration_id`,`discord_thread_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`,`workspace_id`,`inbox_id`,`thread_id`) REFERENCES `message`(`id`,`workspace_id`,`inbox_id`,`thread_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "discord_interaction_command_ck" CHECK("discord_interaction"."command_name" in ('reply', 'status', 'retry')),
	CONSTRAINT "discord_interaction_id_ck" CHECK(length("discord_interaction"."interaction_id") between 1 and 32),
	CONSTRAINT "discord_interaction_external_scope_ck" CHECK(length("discord_interaction"."application_id") between 1 and 32
        and length("discord_interaction"."guild_id") between 1 and 32
        and length("discord_interaction"."discord_thread_id") between 1 and 32
        and length("discord_interaction"."operator_user_id") between 1 and 32),
	CONSTRAINT "discord_interaction_reference_ck" CHECK("discord_interaction"."reference_interaction_id" is null or length("discord_interaction"."reference_interaction_id") between 1 and 32),
	CONSTRAINT "discord_interaction_message_text_ck" CHECK("discord_interaction"."normalized_message" is null or length("discord_interaction"."normalized_message") between 1 and 6000),
	CONSTRAINT "discord_interaction_options_shape_ck" CHECK((
          "discord_interaction"."command_name" = 'reply'
          and "discord_interaction"."reference_interaction_id" is null
          and "discord_interaction"."normalized_message" is not null
          and "discord_interaction"."message_id" is not null
        ) or (
          "discord_interaction"."command_name" = 'status'
          and "discord_interaction"."reference_interaction_id" is not null
          and "discord_interaction"."normalized_message" is null
          and "discord_interaction"."message_id" is null
        ) or (
          "discord_interaction"."command_name" = 'retry'
          and "discord_interaction"."reference_interaction_id" is not null
          and "discord_interaction"."normalized_message" is not null
          and "discord_interaction"."message_id" is null
        )),
	CONSTRAINT "discord_interaction_roles_json_ck" CHECK(json_valid("discord_interaction"."operator_role_ids"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_interaction_message_uq` ON `discord_interaction` (`message_id`);--> statement-breakpoint
CREATE INDEX `discord_interaction_thread_idx` ON `discord_interaction` (`workspace_id`,`thread_id`,`accepted_at`);--> statement-breakpoint
CREATE TABLE `discord_message` (
	`workspace_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`projection_kind` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`nonce` text NOT NULL,
	`correlation_marker` text NOT NULL,
	`discord_thread_id` text NOT NULL,
	`discord_message_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error_code` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`message_id`, `projection_kind`, `chunk_index`),
	FOREIGN KEY (`message_id`,`workspace_id`,`inbox_id`,`thread_id`) REFERENCES `message`(`id`,`workspace_id`,`inbox_id`,`thread_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`,`workspace_id`,`inbox_id`,`integration_id`,`discord_thread_id`) REFERENCES `discord_thread`(`thread_id`,`workspace_id`,`inbox_id`,`integration_id`,`discord_thread_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "discord_message_chunk_index_ck" CHECK("discord_message"."chunk_index" >= 0),
	CONSTRAINT "discord_message_projection_kind_ck" CHECK("discord_message"."projection_kind" in ('customer_projection', 'available_audit', 'failure_audit')),
	CONSTRAINT "discord_message_status_ck" CHECK("discord_message"."status" in ('pending', 'sent', 'failed')),
	CONSTRAINT "discord_message_nonce_ck" CHECK(length("discord_message"."nonce") between 1 and 25),
	CONSTRAINT "discord_message_marker_ck" CHECK(length("discord_message"."correlation_marker") between 1 and 128),
	CONSTRAINT "discord_message_thread_id_ck" CHECK(length("discord_message"."discord_thread_id") between 1 and 32),
	CONSTRAINT "discord_message_external_id_ck" CHECK("discord_message"."discord_message_id" is null or length("discord_message"."discord_message_id") between 1 and 32),
	CONSTRAINT "discord_message_sent_shape_ck" CHECK("discord_message"."status" != 'sent' or "discord_message"."discord_message_id" is not null),
	CONSTRAINT "discord_message_error_code_ck" CHECK("discord_message"."last_error_code" is null or length("discord_message"."last_error_code") between 1 and 128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_message_nonce_uq` ON `discord_message` (`integration_id`,`discord_thread_id`,`nonce`);--> statement-breakpoint
CREATE UNIQUE INDEX `discord_message_external_uq` ON `discord_message` (`integration_id`,`discord_message_id`);--> statement-breakpoint
CREATE INDEX `discord_message_message_idx` ON `discord_message` (`workspace_id`,`thread_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `discord_operator_allowlist` (
	`integration_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`principal_type` text NOT NULL,
	`principal_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`integration_id`, `principal_type`, `principal_id`),
	FOREIGN KEY (`integration_id`,`workspace_id`) REFERENCES `discord_integration`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "discord_operator_allowlist_type_ck" CHECK("discord_operator_allowlist"."principal_type" in ('user', 'role')),
	CONSTRAINT "discord_operator_allowlist_principal_id_ck" CHECK(length("discord_operator_allowlist"."principal_id") between 1 and 32)
);
--> statement-breakpoint
CREATE INDEX `discord_operator_allowlist_workspace_idx` ON `discord_operator_allowlist` (`workspace_id`,`integration_id`);--> statement-breakpoint
CREATE TABLE `discord_thread` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`inbox_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`discord_thread_id` text,
	`state` text DEFAULT 'claiming' NOT NULL,
	`claim_owner` text,
	`claim_expires_at` integer,
	`correlation_marker` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`thread_id`,`workspace_id`,`inbox_id`) REFERENCES `thread`(`id`,`workspace_id`,`inbox_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`integration_id`,`workspace_id`,`inbox_id`) REFERENCES `discord_integration`(`id`,`workspace_id`,`inbox_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "discord_thread_state_ck" CHECK("discord_thread"."state" in ('claiming', 'ready')),
	CONSTRAINT "discord_thread_claim_shape_ck" CHECK((
          "discord_thread"."state" = 'claiming'
          and "discord_thread"."discord_thread_id" is null
          and "discord_thread"."claim_owner" is not null
          and "discord_thread"."claim_expires_at" is not null
        ) or (
          "discord_thread"."state" = 'ready'
          and "discord_thread"."discord_thread_id" is not null
          and "discord_thread"."claim_owner" is null
          and "discord_thread"."claim_expires_at" is null
        )),
	CONSTRAINT "discord_thread_external_id_ck" CHECK("discord_thread"."discord_thread_id" is null or length("discord_thread"."discord_thread_id") between 1 and 32),
	CONSTRAINT "discord_thread_claim_owner_ck" CHECK("discord_thread"."claim_owner" is null or length("discord_thread"."claim_owner") between 1 and 128),
	CONSTRAINT "discord_thread_marker_ck" CHECK(length("discord_thread"."correlation_marker") between 1 and 128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_thread_scope_uq` ON `discord_thread` (`thread_id`,`workspace_id`,`inbox_id`,`integration_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `discord_thread_ready_scope_uq` ON `discord_thread` (`thread_id`,`workspace_id`,`inbox_id`,`integration_id`,`discord_thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `discord_thread_external_uq` ON `discord_thread` (`integration_id`,`discord_thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `discord_thread_marker_uq` ON `discord_thread` (`integration_id`,`correlation_marker`);--> statement-breakpoint
CREATE INDEX `discord_thread_claim_idx` ON `discord_thread` (`state`,`claim_expires_at`);