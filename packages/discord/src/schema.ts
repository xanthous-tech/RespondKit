import type { InboxId, MessageId, ThreadId, WorkspaceId } from "@respondkit/protocol";
import { messages, threads } from "@respondkit/conversations";
import { inboxes } from "@respondkit/workspaces";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const nowInMilliseconds = sql`(unixepoch() * 1000)`;

export const discordThreadStates = ["claiming", "ready"] as const;
export type DiscordThreadState = (typeof discordThreadStates)[number];

export const discordOperatorPrincipalTypes = ["user", "role"] as const;
export type DiscordOperatorPrincipalType = (typeof discordOperatorPrincipalTypes)[number];

export const discordProjectionKinds = [
  "customer_projection",
  "available_audit",
  "failure_audit",
] as const;
export type DiscordProjectionKind = (typeof discordProjectionKinds)[number];

export const discordProjectionStatuses = ["pending", "sent", "failed"] as const;
export type DiscordProjectionStatus = (typeof discordProjectionStatuses)[number];

export const discordInteractionCommandNames = ["reply", "status", "retry"] as const;
export type DiscordInteractionCommandName = (typeof discordInteractionCommandNames)[number];

export const discordIntegrations = sqliteTable(
  "discord_integration",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").$type<WorkspaceId>().notNull(),
    inboxId: text("inbox_id").$type<InboxId>().notNull(),
    applicationId: text("application_id").notNull(),
    guildId: text("guild_id").notNull(),
    forumChannelId: text("forum_channel_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    foreignKey({
      name: "discord_integration_inbox_scope_fk",
      columns: [table.inboxId, table.workspaceId],
      foreignColumns: [inboxes.id, inboxes.workspaceId],
    }).onDelete("cascade"),
    uniqueIndex("discord_integration_inbox_uq").on(table.workspaceId, table.inboxId),
    uniqueIndex("discord_integration_destination_uq").on(
      table.applicationId,
      table.guildId,
      table.forumChannelId,
    ),
    uniqueIndex("discord_integration_id_workspace_uq").on(table.id, table.workspaceId),
    uniqueIndex("discord_integration_id_scope_uq").on(table.id, table.workspaceId, table.inboxId),
    check(
      "discord_integration_application_id_ck",
      sql`length(${table.applicationId}) between 1 and 32`,
    ),
    check("discord_integration_guild_id_ck", sql`length(${table.guildId}) between 1 and 32`),
    check("discord_integration_forum_id_ck", sql`length(${table.forumChannelId}) between 1 and 32`),
  ],
);

export const discordOperatorAllowlists = sqliteTable(
  "discord_operator_allowlist",
  {
    integrationId: text("integration_id").notNull(),
    workspaceId: text("workspace_id").$type<WorkspaceId>().notNull(),
    principalType: text("principal_type", {
      enum: discordOperatorPrincipalTypes,
    }).notNull(),
    principalId: text("principal_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    primaryKey({
      name: "discord_operator_allowlist_pk",
      columns: [table.integrationId, table.principalType, table.principalId],
    }),
    foreignKey({
      name: "discord_operator_allowlist_integration_fk",
      columns: [table.integrationId, table.workspaceId],
      foreignColumns: [discordIntegrations.id, discordIntegrations.workspaceId],
    }).onDelete("cascade"),
    index("discord_operator_allowlist_workspace_idx").on(table.workspaceId, table.integrationId),
    check("discord_operator_allowlist_type_ck", sql`${table.principalType} in ('user', 'role')`),
    check(
      "discord_operator_allowlist_principal_id_ck",
      sql`length(${table.principalId}) between 1 and 32`,
    ),
  ],
);

export const discordThreads = sqliteTable(
  "discord_thread",
  {
    threadId: text("thread_id").$type<ThreadId>().primaryKey(),
    workspaceId: text("workspace_id").$type<WorkspaceId>().notNull(),
    inboxId: text("inbox_id").$type<InboxId>().notNull(),
    integrationId: text("integration_id").notNull(),
    discordThreadId: text("discord_thread_id"),
    state: text("state", { enum: discordThreadStates }).notNull().default("claiming"),
    claimOwner: text("claim_owner"),
    claimExpiresAt: integer("claim_expires_at", { mode: "timestamp_ms" }),
    correlationMarker: text("correlation_marker").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    foreignKey({
      name: "discord_thread_conversation_scope_fk",
      columns: [table.threadId, table.workspaceId, table.inboxId],
      foreignColumns: [threads.id, threads.workspaceId, threads.inboxId],
    }).onDelete("cascade"),
    foreignKey({
      name: "discord_thread_integration_scope_fk",
      columns: [table.integrationId, table.workspaceId, table.inboxId],
      foreignColumns: [
        discordIntegrations.id,
        discordIntegrations.workspaceId,
        discordIntegrations.inboxId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("discord_thread_scope_uq").on(
      table.threadId,
      table.workspaceId,
      table.inboxId,
      table.integrationId,
    ),
    uniqueIndex("discord_thread_ready_scope_uq").on(
      table.threadId,
      table.workspaceId,
      table.inboxId,
      table.integrationId,
      table.discordThreadId,
    ),
    uniqueIndex("discord_thread_external_uq").on(table.integrationId, table.discordThreadId),
    uniqueIndex("discord_thread_marker_uq").on(table.integrationId, table.correlationMarker),
    index("discord_thread_claim_idx").on(table.state, table.claimExpiresAt),
    check("discord_thread_state_ck", sql`${table.state} in ('claiming', 'ready')`),
    check(
      "discord_thread_claim_shape_ck",
      sql`(
          ${table.state} = 'claiming'
          and ${table.discordThreadId} is null
          and ${table.claimOwner} is not null
          and ${table.claimExpiresAt} is not null
        ) or (
          ${table.state} = 'ready'
          and ${table.discordThreadId} is not null
          and ${table.claimOwner} is null
          and ${table.claimExpiresAt} is null
        )`,
    ),
    check(
      "discord_thread_external_id_ck",
      sql`${table.discordThreadId} is null or length(${table.discordThreadId}) between 1 and 32`,
    ),
    check(
      "discord_thread_claim_owner_ck",
      sql`${table.claimOwner} is null or length(${table.claimOwner}) between 1 and 128`,
    ),
    check("discord_thread_marker_ck", sql`length(${table.correlationMarker}) between 1 and 128`),
  ],
);

export const discordMessages = sqliteTable(
  "discord_message",
  {
    workspaceId: text("workspace_id").$type<WorkspaceId>().notNull(),
    inboxId: text("inbox_id").$type<InboxId>().notNull(),
    threadId: text("thread_id").$type<ThreadId>().notNull(),
    messageId: text("message_id").$type<MessageId>().notNull(),
    integrationId: text("integration_id").notNull(),
    projectionKind: text("projection_kind", { enum: discordProjectionKinds }).notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    nonce: text("nonce").notNull(),
    correlationMarker: text("correlation_marker").notNull(),
    discordThreadId: text("discord_thread_id").notNull(),
    discordMessageId: text("discord_message_id"),
    status: text("status", { enum: discordProjectionStatuses }).notNull().default("pending"),
    lastErrorCode: text("last_error_code"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    primaryKey({
      name: "discord_message_pk",
      columns: [table.messageId, table.projectionKind, table.chunkIndex],
    }),
    foreignKey({
      name: "discord_message_message_scope_fk",
      columns: [table.messageId, table.workspaceId, table.inboxId, table.threadId],
      foreignColumns: [messages.id, messages.workspaceId, messages.inboxId, messages.threadId],
    }).onDelete("cascade"),
    foreignKey({
      name: "discord_message_thread_scope_fk",
      columns: [
        table.threadId,
        table.workspaceId,
        table.inboxId,
        table.integrationId,
        table.discordThreadId,
      ],
      foreignColumns: [
        discordThreads.threadId,
        discordThreads.workspaceId,
        discordThreads.inboxId,
        discordThreads.integrationId,
        discordThreads.discordThreadId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("discord_message_nonce_uq").on(
      table.integrationId,
      table.discordThreadId,
      table.nonce,
    ),
    uniqueIndex("discord_message_external_uq").on(table.integrationId, table.discordMessageId),
    index("discord_message_message_idx").on(table.workspaceId, table.threadId, table.messageId),
    check("discord_message_chunk_index_ck", sql`${table.chunkIndex} >= 0`),
    check(
      "discord_message_projection_kind_ck",
      sql`${table.projectionKind} in ('customer_projection', 'available_audit', 'failure_audit')`,
    ),
    check("discord_message_status_ck", sql`${table.status} in ('pending', 'sent', 'failed')`),
    check("discord_message_nonce_ck", sql`length(${table.nonce}) between 1 and 25`),
    check("discord_message_marker_ck", sql`length(${table.correlationMarker}) between 1 and 128`),
    check("discord_message_thread_id_ck", sql`length(${table.discordThreadId}) between 1 and 32`),
    check(
      "discord_message_external_id_ck",
      sql`${table.discordMessageId} is null or length(${table.discordMessageId}) between 1 and 32`,
    ),
    check(
      "discord_message_sent_shape_ck",
      sql`${table.status} != 'sent' or ${table.discordMessageId} is not null`,
    ),
    check(
      "discord_message_error_code_ck",
      sql`${table.lastErrorCode} is null or length(${table.lastErrorCode}) between 1 and 128`,
    ),
  ],
);

export const discordInteractions = sqliteTable(
  "discord_interaction",
  {
    integrationId: text("integration_id").notNull(),
    interactionId: text("interaction_id").notNull(),
    workspaceId: text("workspace_id").$type<WorkspaceId>().notNull(),
    inboxId: text("inbox_id").$type<InboxId>().notNull(),
    threadId: text("thread_id").$type<ThreadId>().notNull(),
    messageId: text("message_id").$type<MessageId>(),
    applicationId: text("application_id").notNull(),
    guildId: text("guild_id").notNull(),
    discordThreadId: text("discord_thread_id").notNull(),
    operatorUserId: text("operator_user_id").notNull(),
    operatorRoleIds: text("operator_role_ids", { mode: "json" })
      .$type<readonly string[]>()
      .notNull()
      .default(sql`'[]'`),
    commandName: text("command_name", {
      enum: discordInteractionCommandNames,
    }).notNull(),
    referenceInteractionId: text("reference_interaction_id"),
    normalizedMessage: text("normalized_message"),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    primaryKey({
      name: "discord_interaction_pk",
      columns: [table.integrationId, table.interactionId],
    }),
    foreignKey({
      name: "discord_interaction_integration_scope_fk",
      columns: [table.integrationId, table.workspaceId, table.inboxId],
      foreignColumns: [
        discordIntegrations.id,
        discordIntegrations.workspaceId,
        discordIntegrations.inboxId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "discord_interaction_thread_scope_fk",
      columns: [table.threadId, table.workspaceId, table.inboxId],
      foreignColumns: [threads.id, threads.workspaceId, threads.inboxId],
    }).onDelete("cascade"),
    foreignKey({
      name: "discord_interaction_mapping_scope_fk",
      columns: [
        table.threadId,
        table.workspaceId,
        table.inboxId,
        table.integrationId,
        table.discordThreadId,
      ],
      foreignColumns: [
        discordThreads.threadId,
        discordThreads.workspaceId,
        discordThreads.inboxId,
        discordThreads.integrationId,
        discordThreads.discordThreadId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "discord_interaction_message_scope_fk",
      columns: [table.messageId, table.workspaceId, table.inboxId, table.threadId],
      foreignColumns: [messages.id, messages.workspaceId, messages.inboxId, messages.threadId],
    }).onDelete("cascade"),
    uniqueIndex("discord_interaction_message_uq").on(table.messageId),
    index("discord_interaction_thread_idx").on(table.workspaceId, table.threadId, table.acceptedAt),
    check(
      "discord_interaction_command_ck",
      sql`${table.commandName} in ('reply', 'status', 'retry')`,
    ),
    check("discord_interaction_id_ck", sql`length(${table.interactionId}) between 1 and 32`),
    check(
      "discord_interaction_external_scope_ck",
      sql`length(${table.applicationId}) between 1 and 32
        and length(${table.guildId}) between 1 and 32
        and length(${table.discordThreadId}) between 1 and 32
        and length(${table.operatorUserId}) between 1 and 32`,
    ),
    check(
      "discord_interaction_reference_ck",
      sql`${table.referenceInteractionId} is null or length(${table.referenceInteractionId}) between 1 and 32`,
    ),
    check(
      "discord_interaction_message_text_ck",
      sql`${table.normalizedMessage} is null or length(${table.normalizedMessage}) between 1 and 6000`,
    ),
    check(
      "discord_interaction_options_shape_ck",
      sql`(
          ${table.commandName} = 'reply'
          and ${table.referenceInteractionId} is null
          and ${table.normalizedMessage} is not null
          and ${table.messageId} is not null
        ) or (
          ${table.commandName} = 'status'
          and ${table.referenceInteractionId} is not null
          and ${table.normalizedMessage} is null
          and ${table.messageId} is null
        ) or (
          ${table.commandName} = 'retry'
          and ${table.referenceInteractionId} is not null
          and ${table.normalizedMessage} is not null
          and ${table.messageId} is null
        )`,
    ),
    check("discord_interaction_roles_json_ck", sql`json_valid(${table.operatorRoleIds})`),
  ],
);

export type DiscordIntegrationRow = typeof discordIntegrations.$inferSelect;
export type NewDiscordIntegrationRow = typeof discordIntegrations.$inferInsert;
export type DiscordOperatorAllowlistRow = typeof discordOperatorAllowlists.$inferSelect;
export type NewDiscordOperatorAllowlistRow = typeof discordOperatorAllowlists.$inferInsert;
export type DiscordThreadRow = typeof discordThreads.$inferSelect;
export type NewDiscordThreadRow = typeof discordThreads.$inferInsert;
export type DiscordMessageRow = typeof discordMessages.$inferSelect;
export type NewDiscordMessageRow = typeof discordMessages.$inferInsert;
export type DiscordInteractionRow = typeof discordInteractions.$inferSelect;
export type NewDiscordInteractionRow = typeof discordInteractions.$inferInsert;
