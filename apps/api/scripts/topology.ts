/// <reference types="node" />

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { discordIntegrationConfigurationSchema } from "@respondkit/discord";
import {
  inboxConfigurationSchema,
  productConfigurationSchema,
  workspaceConfigurationSchema,
} from "@respondkit/workspaces";
import { z } from "zod";

const configuredInboxSchema = inboxConfigurationSchema.extend({
  discord: discordIntegrationConfigurationSchema,
});

const configuredProductSchema = productConfigurationSchema.extend({
  inboxes: z.array(configuredInboxSchema).min(1).max(100),
});

const configuredWorkspaceSchema = workspaceConfigurationSchema.extend({
  products: z.array(configuredProductSchema).min(1).max(100),
});

export const topologyConfigurationSchema = z
  .strictObject({
    workspaces: z.array(configuredWorkspaceSchema).min(1).max(100),
  })
  .superRefine((configuration, context) => {
    const workspaceIds = new Set<string>();
    const workspaceSlugs = new Set<string>();
    const productIds = new Set<string>();
    const inboxIds = new Set<string>();
    const integrationIds = new Set<string>();
    const discordDestinations = new Set<string>();
    let discordApplicationId: string | undefined;

    for (const [workspaceIndex, workspace] of configuration.workspaces.entries()) {
      addUniqueIssue(context, workspaceIds, workspace.id, ["workspaces", workspaceIndex, "id"]);
      addUniqueIssue(context, workspaceSlugs, workspace.slug, [
        "workspaces",
        workspaceIndex,
        "slug",
      ]);

      const productSlugs = new Set<string>();

      for (const [productIndex, product] of workspace.products.entries()) {
        addUniqueIssue(context, productIds, product.id, [
          "workspaces",
          workspaceIndex,
          "products",
          productIndex,
          "id",
        ]);
        addUniqueIssue(context, productSlugs, product.slug, [
          "workspaces",
          workspaceIndex,
          "products",
          productIndex,
          "slug",
        ]);

        for (const [inboxIndex, inbox] of product.inboxes.entries()) {
          const path = [
            "workspaces",
            workspaceIndex,
            "products",
            productIndex,
            "inboxes",
            inboxIndex,
          ] as const;

          addUniqueIssue(context, inboxIds, inbox.id, [...path, "id"]);
          addUniqueIssue(context, integrationIds, inbox.discord.id, [...path, "discord", "id"]);

          if (discordApplicationId === undefined) {
            discordApplicationId = inbox.discord.applicationId;
          } else if (discordApplicationId !== inbox.discord.applicationId) {
            context.addIssue({
              code: "custom",
              message:
                "All Discord integrations in one API deployment must use the same application ID",
              path: [...path, "discord", "applicationId"],
            });
          }

          addUniqueIssue(
            context,
            discordDestinations,
            [inbox.discord.applicationId, inbox.discord.guildId, inbox.discord.forumChannelId].join(
              ":",
            ),
            [...path, "discord", "forumChannelId"],
          );

          const origins = new Set<string>();
          for (const [originIndex, origin] of inbox.allowedOrigins.entries()) {
            addUniqueIssue(context, origins, origin, [...path, "allowedOrigins", originIndex]);
          }
        }
      }
    }
  });

export type TopologyConfiguration = z.infer<typeof topologyConfigurationSchema>;

export interface DiscordCommandTarget {
  readonly applicationId: string;
  readonly guildId: string;
}

function addUniqueIssue(
  context: z.RefinementCtx,
  values: Set<string>,
  value: string,
  path: readonly PropertyKey[],
): void {
  if (values.has(value)) {
    context.addIssue({
      code: "custom",
      message: `Duplicate configuration value: ${value}`,
      path: [...path],
    });
    return;
  }

  values.add(value);
}

export async function loadTopologyConfiguration(path: string): Promise<TopologyConfiguration> {
  const absolutePath = resolve(path);
  let source: string;

  try {
    source = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new Error(`Unable to read topology configuration at ${absolutePath}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Topology configuration is not valid JSON: ${absolutePath}`, { cause: error });
  }

  const result = topologyConfigurationSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(z.prettifyError(result.error));
  }

  return result.data;
}

export function collectDiscordCommandTargets(
  configuration: TopologyConfiguration,
): readonly DiscordCommandTarget[] {
  const targets = new Map<string, DiscordCommandTarget>();

  forEachInbox(configuration, ({ discord }) => {
    const target = {
      applicationId: discord.applicationId,
      guildId: discord.guildId,
    } satisfies DiscordCommandTarget;
    targets.set(`${target.applicationId}:${target.guildId}`, target);
  });

  return [...targets.values()].sort((left, right) =>
    `${left.applicationId}:${left.guildId}`.localeCompare(
      `${right.applicationId}:${right.guildId}`,
    ),
  );
}

export function buildTopologySeedSql(configuration: TopologyConfiguration): string {
  const statements = [
    "-- Generated by apps/api/scripts/config-apply.ts. Safe to rerun.",
    "PRAGMA foreign_keys = ON;",
  ];

  for (const workspace of configuration.workspaces) {
    statements.push(
      `INSERT INTO workspace (id, slug, name, status) VALUES (${sqlText(workspace.id)}, ${sqlText(workspace.slug)}, ${sqlText(workspace.name)}, 'active') ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, name = excluded.name, status = 'active', updated_at = unixepoch() * 1000;`,
    );

    for (const product of workspace.products) {
      statements.push(
        `INSERT INTO product (id, workspace_id, slug, name) VALUES (${sqlText(product.id)}, ${sqlText(workspace.id)}, ${sqlText(product.slug)}, ${sqlText(product.name)}) ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, slug = excluded.slug, name = excluded.name, updated_at = unixepoch() * 1000;`,
      );

      for (const inbox of product.inboxes) {
        statements.push(
          `INSERT INTO inbox (id, workspace_id, product_id, name, status, default_locale) VALUES (${sqlText(inbox.id)}, ${sqlText(workspace.id)}, ${sqlText(product.id)}, ${sqlText(inbox.name)}, 'active', ${sqlNullableText(inbox.defaultLocale)}) ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, product_id = excluded.product_id, name = excluded.name, status = 'active', default_locale = excluded.default_locale, updated_at = unixepoch() * 1000;`,
        );

        const originValues = inbox.allowedOrigins.map((origin) => sqlText(origin)).join(", ");
        statements.push(
          `DELETE FROM allowed_origin WHERE workspace_id = ${sqlText(workspace.id)} AND inbox_id = ${sqlText(inbox.id)} AND origin NOT IN (${originValues});`,
        );

        for (const origin of inbox.allowedOrigins) {
          const originId = stableConfigurationId("origin", [workspace.id, inbox.id, origin]);
          statements.push(
            `INSERT INTO allowed_origin (id, workspace_id, inbox_id, origin) VALUES (${sqlText(originId)}, ${sqlText(workspace.id)}, ${sqlText(inbox.id)}, ${sqlText(origin)}) ON CONFLICT(workspace_id, inbox_id, origin) DO UPDATE SET id = excluded.id;`,
          );
        }

        const discord = inbox.discord;
        statements.push(
          `INSERT INTO discord_integration (id, workspace_id, inbox_id, application_id, guild_id, forum_channel_id) VALUES (${sqlText(discord.id)}, ${sqlText(workspace.id)}, ${sqlText(inbox.id)}, ${sqlText(discord.applicationId)}, ${sqlText(discord.guildId)}, ${sqlText(discord.forumChannelId)}) ON CONFLICT(id) DO UPDATE SET workspace_id = excluded.workspace_id, inbox_id = excluded.inbox_id, application_id = excluded.application_id, guild_id = excluded.guild_id, forum_channel_id = excluded.forum_channel_id, updated_at = unixepoch() * 1000;`,
        );

        const operatorPredicates = [
          discord.operators.userIds.length > 0
            ? `(principal_type = 'user' AND principal_id IN (${discord.operators.userIds.map(sqlText).join(", ")}))`
            : undefined,
          discord.operators.roleIds.length > 0
            ? `(principal_type = 'role' AND principal_id IN (${discord.operators.roleIds.map(sqlText).join(", ")}))`
            : undefined,
        ].filter((predicate): predicate is string => predicate !== undefined);

        statements.push(
          `DELETE FROM discord_operator_allowlist WHERE integration_id = ${sqlText(discord.id)} AND workspace_id = ${sqlText(workspace.id)} AND NOT (${operatorPredicates.join(" OR ")});`,
        );

        for (const userId of discord.operators.userIds) {
          statements.push(buildOperatorInsert(discord.id, workspace.id, "user", userId));
        }

        for (const roleId of discord.operators.roleIds) {
          statements.push(buildOperatorInsert(discord.id, workspace.id, "role", roleId));
        }
      }
    }
  }

  return `${statements.join("\n")}\n`;
}

export function listPublicInboxIds(configuration: TopologyConfiguration): readonly string[] {
  const inboxIds: string[] = [];
  forEachInbox(configuration, (inbox) => inboxIds.push(inbox.id));
  return inboxIds;
}

function buildOperatorInsert(
  integrationId: string,
  workspaceId: string,
  principalType: "role" | "user",
  principalId: string,
): string {
  return `INSERT INTO discord_operator_allowlist (integration_id, workspace_id, principal_type, principal_id) VALUES (${sqlText(integrationId)}, ${sqlText(workspaceId)}, ${sqlText(principalType)}, ${sqlText(principalId)}) ON CONFLICT(integration_id, principal_type, principal_id) DO NOTHING;`;
}

function stableConfigurationId(prefix: string, parts: readonly string[]): string {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
  return `${prefix}_${digest}`;
}

function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlNullableText(value: string | undefined): string {
  return value === undefined ? "NULL" : sqlText(value);
}

function forEachInbox(
  configuration: TopologyConfiguration,
  callback: (
    inbox: TopologyConfiguration["workspaces"][number]["products"][number]["inboxes"][number],
  ) => void,
): void {
  for (const workspace of configuration.workspaces) {
    for (const product of workspace.products) {
      for (const inbox of product.inboxes) callback(inbox);
    }
  }
}
