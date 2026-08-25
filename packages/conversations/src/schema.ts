import type {
  ClientMessageId,
  ClientThreadId,
  InboxId,
  MessageDirection,
  MessageId,
  ThreadId,
  VisitorId,
  WorkflowInstanceId,
  WorkspaceId,
} from "@agent-chat/protocol";
import { inboxes, visitors } from "@agent-chat/workspaces";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const nowInMilliseconds = sql`(unixepoch() * 1000)`;

export const threadStatuses = ["open", "closed"] as const;
export type ThreadStatus = (typeof threadStatuses)[number];

export const messageDirections = [
  "customer_to_operator",
  "operator_to_customer",
] as const satisfies readonly MessageDirection[];

export const messageProcessingStatuses = ["processing", "retrying", "succeeded", "failed"] as const;
export type MessageProcessingStatus = (typeof messageProcessingStatuses)[number];

export const customerAvailabilityStatuses = ["pending", "available", "not_available"] as const;
export type CustomerAvailabilityStatus = (typeof customerAvailabilityStatuses)[number];

export const operatorProjectionStatuses = [
  "pending",
  "projected",
  "failed",
  "not_applicable",
] as const;
export type OperatorProjectionStatus = (typeof operatorProjectionStatuses)[number];

export const discordAuditStatuses = ["pending", "projected", "failed", "not_applicable"] as const;
export type DiscordAuditStatus = (typeof discordAuditStatuses)[number];

export const messageFailureStages = [
  "ingress",
  "translation",
  "publish",
  "discord_thread",
  "discord_projection",
  "discord_audit",
] as const;
export type MessageFailureStage = (typeof messageFailureStages)[number];

export const threads = sqliteTable(
  "thread",
  {
    id: text("id").$type<ThreadId>().primaryKey(),
    workspaceId: text("workspace_id").$type<WorkspaceId>().notNull(),
    inboxId: text("inbox_id").$type<InboxId>().notNull(),
    visitorId: text("visitor_id").$type<VisitorId>().notNull(),
    clientThreadId: text("client_thread_id").$type<ClientThreadId>().notNull(),
    status: text("status", { enum: threadStatuses }).notNull().default("open"),
    customerLanguage: text("customer_language"),
    customerLanguageUpdatedAt: integer("customer_language_updated_at", {
      mode: "timestamp_ms",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
    lastActivityAt: integer("last_activity_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    foreignKey({
      name: "thread_inbox_workspace_fk",
      columns: [table.inboxId, table.workspaceId],
      foreignColumns: [inboxes.id, inboxes.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "thread_visitor_scope_fk",
      columns: [table.visitorId, table.workspaceId, table.inboxId],
      foreignColumns: [visitors.id, visitors.workspaceId, visitors.inboxId],
    }).onDelete("cascade"),
    uniqueIndex("thread_id_workspace_inbox_uq").on(table.id, table.workspaceId, table.inboxId),
    uniqueIndex("thread_client_id_visitor_uq").on(
      table.workspaceId,
      table.inboxId,
      table.visitorId,
      table.clientThreadId,
    ),
    index("thread_visitor_activity_idx").on(
      table.workspaceId,
      table.inboxId,
      table.visitorId,
      table.lastActivityAt,
    ),
    index("thread_inbox_activity_idx").on(table.workspaceId, table.inboxId, table.lastActivityAt),
    check("thread_status_ck", sql`${table.status} in ('open', 'closed')`),
    check("thread_client_id_length_ck", sql`length(${table.clientThreadId}) between 1 and 128`),
    check(
      "thread_customer_language_length_ck",
      sql`${table.customerLanguage} is null or length(${table.customerLanguage}) between 2 and 35`,
    ),
  ],
);

export const messages = sqliteTable(
  "message",
  {
    rowId: integer("row_id").primaryKey({ autoIncrement: true }),
    id: text("id").$type<MessageId>().notNull(),
    workspaceId: text("workspace_id").$type<WorkspaceId>().notNull(),
    inboxId: text("inbox_id").$type<InboxId>().notNull(),
    threadId: text("thread_id").$type<ThreadId>().notNull(),
    clientMessageId: text("client_message_id").$type<ClientMessageId>(),
    workflowInstanceId: text("workflow_instance_id").$type<WorkflowInstanceId>().notNull(),
    direction: text("direction", { enum: messageDirections }).$type<MessageDirection>().notNull(),
    originalText: text("original_text").notNull(),
    originalLanguage: text("original_language"),
    customerVisibleText: text("customer_visible_text"),
    customerVisibleLanguage: text("customer_visible_language"),
    operatorVisibleText: text("operator_visible_text"),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }).notNull(),
    processingGeneration: integer("processing_generation").notNull().default(1),
    processingStatus: text("processing_status", {
      enum: messageProcessingStatuses,
    })
      .notNull()
      .default("processing"),
    customerAvailability: text("customer_availability", {
      enum: customerAvailabilityStatuses,
    })
      .notNull()
      .default("pending"),
    operatorProjectionStatus: text("operator_projection_status", {
      enum: operatorProjectionStatuses,
    })
      .notNull()
      .default("not_applicable"),
    discordAuditStatus: text("discord_audit_status", {
      enum: discordAuditStatuses,
    })
      .notNull()
      .default("not_applicable"),
    failureStage: text("failure_stage", { enum: messageFailureStages }),
    failureCode: text("failure_code"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    foreignKey({
      name: "message_thread_scope_fk",
      columns: [table.threadId, table.workspaceId, table.inboxId],
      foreignColumns: [threads.id, threads.workspaceId, threads.inboxId],
    }).onDelete("cascade"),
    uniqueIndex("message_id_uq").on(table.id),
    uniqueIndex("message_workflow_instance_uq").on(table.workflowInstanceId),
    uniqueIndex("message_thread_client_id_uq").on(
      table.workspaceId,
      table.threadId,
      table.clientMessageId,
    ),
    uniqueIndex("message_id_scope_uq").on(
      table.id,
      table.workspaceId,
      table.inboxId,
      table.threadId,
    ),
    index("message_thread_cursor_idx").on(table.workspaceId, table.threadId, table.rowId),
    index("message_thread_display_idx").on(
      table.workspaceId,
      table.threadId,
      table.acceptedAt,
      table.id,
    ),
    index("message_processing_idx").on(table.workspaceId, table.processingStatus, table.updatedAt),
    check(
      "message_direction_ck",
      sql`${table.direction} in ('customer_to_operator', 'operator_to_customer')`,
    ),
    check("message_original_text_length_ck", sql`length(${table.originalText}) between 1 and 6000`),
    check(
      "message_customer_text_length_ck",
      sql`${table.customerVisibleText} is null or length(${table.customerVisibleText}) between 1 and 6000`,
    ),
    check(
      "message_operator_text_length_ck",
      sql`${table.operatorVisibleText} is null or length(${table.operatorVisibleText}) between 1 and 6000`,
    ),
    check(
      "message_original_language_length_ck",
      sql`${table.originalLanguage} is null or length(${table.originalLanguage}) between 2 and 35`,
    ),
    check(
      "message_customer_language_length_ck",
      sql`${table.customerVisibleLanguage} is null or length(${table.customerVisibleLanguage}) between 2 and 35`,
    ),
    check("message_generation_ck", sql`${table.processingGeneration} >= 1`),
    check(
      "message_processing_status_ck",
      sql`${table.processingStatus} in ('processing', 'retrying', 'succeeded', 'failed')`,
    ),
    check(
      "message_customer_availability_ck",
      sql`${table.customerAvailability} in ('pending', 'available', 'not_available')`,
    ),
    check(
      "message_operator_projection_status_ck",
      sql`${table.operatorProjectionStatus} in ('pending', 'projected', 'failed', 'not_applicable')`,
    ),
    check(
      "message_discord_audit_status_ck",
      sql`${table.discordAuditStatus} in ('pending', 'projected', 'failed', 'not_applicable')`,
    ),
    check(
      "message_failure_stage_ck",
      sql`${table.failureStage} is null or ${table.failureStage} in ('ingress', 'translation', 'publish', 'discord_thread', 'discord_projection', 'discord_audit')`,
    ),
    check(
      "message_failure_code_length_ck",
      sql`${table.failureCode} is null or length(${table.failureCode}) between 1 and 128`,
    ),
    check(
      "message_client_id_direction_ck",
      sql`(${table.direction} = 'customer_to_operator' and ${table.clientMessageId} is not null)
        or (${table.direction} = 'operator_to_customer' and ${table.clientMessageId} is null)`,
    ),
    check(
      "message_initial_visibility_ck",
      sql`${table.direction} != 'customer_to_operator' or ${table.customerVisibleText} is not null`,
    ),
  ],
);

export const customerTranscriptEventKinds = ["processing", "available", "failed"] as const;
export type CustomerTranscriptEventKind = (typeof customerTranscriptEventKinds)[number];

/**
 * Append-only customer transcript revisions. Message rows mutate as Workflows
 * advance, so each customer-observable state transition gets its own cursor.
 * The composite identity keeps a replay of the same Workflow step idempotent.
 */
export const customerTranscriptEntries = sqliteTable(
  "customer_transcript_entry",
  {
    rowId: integer("row_id").primaryKey({ autoIncrement: true }),
    workspaceId: text("workspace_id").$type<WorkspaceId>().notNull(),
    inboxId: text("inbox_id").$type<InboxId>().notNull(),
    threadId: text("thread_id").$type<ThreadId>().notNull(),
    messageId: text("message_id").$type<MessageId>().notNull(),
    processingGeneration: integer("processing_generation").notNull(),
    eventKind: text("event_kind", { enum: customerTranscriptEventKinds }).notNull(),
    eventAt: integer("event_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "customer_transcript_entry_message_scope_fk",
      columns: [table.messageId, table.workspaceId, table.inboxId, table.threadId],
      foreignColumns: [messages.id, messages.workspaceId, messages.inboxId, messages.threadId],
    }).onDelete("cascade"),
    uniqueIndex("customer_transcript_entry_revision_uq").on(
      table.messageId,
      table.processingGeneration,
      table.eventKind,
    ),
    index("customer_transcript_entry_thread_cursor_idx").on(
      table.workspaceId,
      table.inboxId,
      table.threadId,
      table.rowId,
    ),
    check("customer_transcript_entry_generation_ck", sql`${table.processingGeneration} >= 1`),
    check(
      "customer_transcript_entry_kind_ck",
      sql`${table.eventKind} in ('processing', 'available', 'failed')`,
    ),
  ],
);

export const messageTranslations = sqliteTable(
  "message_translation",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").$type<WorkspaceId>().notNull(),
    inboxId: text("inbox_id").$type<InboxId>().notNull(),
    threadId: text("thread_id").$type<ThreadId>().notNull(),
    messageId: text("message_id").$type<MessageId>().notNull(),
    sourceLanguage: text("source_language").notNull(),
    targetLanguage: text("target_language").notNull(),
    translatedText: text("translated_text").notNull(),
    promptVersion: text("prompt_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    isPassThrough: integer("is_pass_through", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    foreignKey({
      name: "message_translation_message_scope_fk",
      columns: [table.messageId, table.workspaceId, table.inboxId, table.threadId],
      foreignColumns: [messages.id, messages.workspaceId, messages.inboxId, messages.threadId],
    }).onDelete("cascade"),
    uniqueIndex("message_translation_identity_uq").on(
      table.messageId,
      table.targetLanguage,
      table.promptVersion,
    ),
    index("message_translation_message_idx").on(table.workspaceId, table.threadId, table.messageId),
    check(
      "message_translation_source_language_length_ck",
      sql`length(${table.sourceLanguage}) between 2 and 35`,
    ),
    check(
      "message_translation_target_language_length_ck",
      sql`length(${table.targetLanguage}) between 2 and 35`,
    ),
    check(
      "message_translation_text_length_ck",
      sql`length(${table.translatedText}) between 1 and 6000`,
    ),
    check(
      "message_translation_prompt_version_length_ck",
      sql`length(${table.promptVersion}) between 1 and 80`,
    ),
    check(
      "message_translation_provider_length_ck",
      sql`length(${table.provider}) between 1 and 80`,
    ),
    check("message_translation_model_length_ck", sql`length(${table.model}) between 1 and 160`),
  ],
);

export type ThreadRow = typeof threads.$inferSelect;
export type NewThreadRow = typeof threads.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type CustomerTranscriptEntryRow = typeof customerTranscriptEntries.$inferSelect;
export type NewCustomerTranscriptEntryRow = typeof customerTranscriptEntries.$inferInsert;
export type MessageTranslationRow = typeof messageTranslations.$inferSelect;
export type NewMessageTranslationRow = typeof messageTranslations.$inferInsert;
