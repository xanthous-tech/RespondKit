import type {
  InboxId,
  InstallationId,
  JsonValue,
  VisitorId,
  WorkspaceId,
} from "@agent-chat/protocol";
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

export const workspaceStatuses = ["active", "disabled"] as const;
export type WorkspaceStatus = (typeof workspaceStatuses)[number];

export const inboxStatuses = ["active", "disabled"] as const;
export type InboxStatus = (typeof inboxStatuses)[number];

export const workspaces = sqliteTable(
  "workspace",
  {
    id: text("id").$type<WorkspaceId>().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: workspaceStatuses }).notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("workspace_slug_uq").on(table.slug),
    check("workspace_slug_length_ck", sql`length(${table.slug}) between 1 and 80`),
    check("workspace_name_length_ck", sql`length(${table.name}) between 1 and 160`),
    check("workspace_status_ck", sql`${table.status} in ('active', 'disabled')`),
  ],
);

export const products = sqliteTable(
  "product",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .$type<WorkspaceId>()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    uniqueIndex("product_workspace_slug_uq").on(table.workspaceId, table.slug),
    uniqueIndex("product_id_workspace_uq").on(table.id, table.workspaceId),
    index("product_workspace_idx").on(table.workspaceId),
    check("product_slug_length_ck", sql`length(${table.slug}) between 1 and 80`),
    check("product_name_length_ck", sql`length(${table.name}) between 1 and 160`),
  ],
);

export const inboxes = sqliteTable(
  "inbox",
  {
    id: text("id").$type<InboxId>().primaryKey(),
    workspaceId: text("workspace_id").$type<WorkspaceId>().notNull(),
    productId: text("product_id").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: inboxStatuses }).notNull().default("active"),
    defaultLocale: text("default_locale"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    foreignKey({
      name: "inbox_product_workspace_fk",
      columns: [table.productId, table.workspaceId],
      foreignColumns: [products.id, products.workspaceId],
    }).onDelete("cascade"),
    uniqueIndex("inbox_id_workspace_uq").on(table.id, table.workspaceId),
    index("inbox_product_idx").on(table.workspaceId, table.productId),
    check("inbox_name_length_ck", sql`length(${table.name}) between 1 and 160`),
    check("inbox_status_ck", sql`${table.status} in ('active', 'disabled')`),
    check(
      "inbox_default_locale_length_ck",
      sql`${table.defaultLocale} is null or length(${table.defaultLocale}) between 2 and 35`,
    ),
  ],
);

export const allowedOrigins = sqliteTable(
  "allowed_origin",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").$type<WorkspaceId>().notNull(),
    inboxId: text("inbox_id").$type<InboxId>().notNull(),
    origin: text("origin").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
  },
  (table) => [
    foreignKey({
      name: "allowed_origin_inbox_workspace_fk",
      columns: [table.inboxId, table.workspaceId],
      foreignColumns: [inboxes.id, inboxes.workspaceId],
    }).onDelete("cascade"),
    uniqueIndex("allowed_origin_inbox_origin_uq").on(
      table.workspaceId,
      table.inboxId,
      table.origin,
    ),
    index("allowed_origin_inbox_idx").on(table.workspaceId, table.inboxId),
    check("allowed_origin_origin_length_ck", sql`length(${table.origin}) between 8 and 2048`),
  ],
);

export const visitors = sqliteTable(
  "visitor",
  {
    id: text("id").$type<VisitorId>().primaryKey(),
    workspaceId: text("workspace_id").$type<WorkspaceId>().notNull(),
    inboxId: text("inbox_id").$type<InboxId>().notNull(),
    installationId: text("installation_id").$type<InstallationId>().notNull(),
    externalUserId: text("external_user_id"),
    email: text("email"),
    posthogDistinctId: text("posthog_distinct_id"),
    locale: text("locale"),
    timezone: text("timezone"),
    region: text("region"),
    userAgent: text("user_agent"),
    metadata: text("metadata", { mode: "json" })
      .$type<Record<string, JsonValue>>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowInMilliseconds),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowInMilliseconds),
  },
  (table) => [
    foreignKey({
      name: "visitor_inbox_workspace_fk",
      columns: [table.inboxId, table.workspaceId],
      foreignColumns: [inboxes.id, inboxes.workspaceId],
    }).onDelete("cascade"),
    uniqueIndex("visitor_id_workspace_inbox_uq").on(table.id, table.workspaceId, table.inboxId),
    uniqueIndex("visitor_installation_inbox_uq").on(
      table.workspaceId,
      table.inboxId,
      table.installationId,
    ),
    uniqueIndex("visitor_external_user_inbox_uq").on(
      table.workspaceId,
      table.inboxId,
      table.externalUserId,
    ),
    index("visitor_inbox_last_seen_idx").on(table.workspaceId, table.inboxId, table.lastSeenAt),
    check(
      "visitor_installation_id_length_ck",
      sql`length(${table.installationId}) between 1 and 128`,
    ),
    check(
      "visitor_external_user_id_length_ck",
      sql`${table.externalUserId} is null or length(${table.externalUserId}) between 1 and 512`,
    ),
    check(
      "visitor_email_length_ck",
      sql`${table.email} is null or length(${table.email}) between 3 and 320`,
    ),
    check(
      "visitor_posthog_id_length_ck",
      sql`${table.posthogDistinctId} is null or length(${table.posthogDistinctId}) between 1 and 512`,
    ),
    check(
      "visitor_locale_length_ck",
      sql`${table.locale} is null or length(${table.locale}) between 2 and 35`,
    ),
    check(
      "visitor_timezone_length_ck",
      sql`${table.timezone} is null or length(${table.timezone}) between 1 and 64`,
    ),
    check(
      "visitor_region_length_ck",
      sql`${table.region} is null or length(${table.region}) between 2 and 80`,
    ),
    check(
      "visitor_user_agent_length_ck",
      sql`${table.userAgent} is null or length(${table.userAgent}) between 1 and 1024`,
    ),
    check("visitor_metadata_length_ck", sql`length(${table.metadata}) <= 16384`),
  ],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type NewWorkspaceRow = typeof workspaces.$inferInsert;
export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;
export type InboxRow = typeof inboxes.$inferSelect;
export type NewInboxRow = typeof inboxes.$inferInsert;
export type AllowedOriginRow = typeof allowedOrigins.$inferSelect;
export type NewAllowedOriginRow = typeof allowedOrigins.$inferInsert;
export type VisitorRow = typeof visitors.$inferSelect;
export type NewVisitorRow = typeof visitors.$inferInsert;
