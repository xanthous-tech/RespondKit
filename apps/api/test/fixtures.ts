import { createDiscordCorrelationMarker } from "@respondkit/discord";
import {
  CreateClientSessionResponseV1Schema,
  CreateThreadResponseV1Schema,
  type SessionToken,
  type ThreadId,
} from "@respondkit/protocol";
import { env } from "cloudflare:test";

import type { Env } from "../src/env";
import { createHttpApp } from "../src/http";

export const TEST_ORIGIN = "https://widget.example.test";

export const TEST_TOPOLOGY = {
  workspaceId: "workspace_test",
  productId: "product_test",
  inboxId: "inbox_public_test",
  integrationId: "discord_integration_test",
  applicationId: "100000000000000002",
  guildId: "100000000000000003",
  forumChannelId: "100000000000000005",
  discordThreadId: "100000000000000004",
  operatorId: "100000000000000006",
  operatorRoleId: "100000000000000007",
} as const;

export function createTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: env.DB,
    MESSAGE_WORKFLOW: env.MESSAGE_WORKFLOW,
    ENVIRONMENT: "test",
    GEMINI_MODEL: "gemini-3.1-flash-lite-preview",
    DISCORD_API_BASE_URL: "https://discord.invalid/api/v10",
    GEMINI_API_KEY: "test-only",
    DISCORD_BOT_TOKEN: "test-only",
    DISCORD_APPLICATION_ID: TEST_TOPOLOGY.applicationId,
    DISCORD_PUBLIC_KEY: "00".repeat(32),
    SESSION_SIGNING_KEY: "test-only-session-signing-key",
    ...overrides,
  };
}

export async function seedTopology(database: D1Database = env.DB): Promise<void> {
  const timestamp = Date.now();
  await database.batch([
    database
      .prepare(
        "insert into workspace (id, slug, name, status, created_at, updated_at) values (?, ?, ?, 'active', ?, ?)",
      )
      .bind(TEST_TOPOLOGY.workspaceId, "test-workspace", "Test Workspace", timestamp, timestamp),
    database
      .prepare(
        "insert into product (id, workspace_id, slug, name, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        TEST_TOPOLOGY.productId,
        TEST_TOPOLOGY.workspaceId,
        "test-product",
        "Test Product",
        timestamp,
        timestamp,
      ),
    database
      .prepare(
        "insert into inbox (id, workspace_id, product_id, name, status, default_locale, created_at, updated_at) values (?, ?, ?, ?, 'active', ?, ?, ?)",
      )
      .bind(
        TEST_TOPOLOGY.inboxId,
        TEST_TOPOLOGY.workspaceId,
        TEST_TOPOLOGY.productId,
        "Test Inbox",
        "en",
        timestamp,
        timestamp,
      ),
    database
      .prepare(
        "insert into allowed_origin (id, workspace_id, inbox_id, origin, created_at) values (?, ?, ?, ?, ?)",
      )
      .bind(
        "allowed_origin_test",
        TEST_TOPOLOGY.workspaceId,
        TEST_TOPOLOGY.inboxId,
        TEST_ORIGIN,
        timestamp,
      ),
    database
      .prepare(
        "insert into discord_integration (id, workspace_id, inbox_id, application_id, guild_id, forum_channel_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        TEST_TOPOLOGY.integrationId,
        TEST_TOPOLOGY.workspaceId,
        TEST_TOPOLOGY.inboxId,
        TEST_TOPOLOGY.applicationId,
        TEST_TOPOLOGY.guildId,
        TEST_TOPOLOGY.forumChannelId,
        timestamp,
        timestamp,
      ),
    database
      .prepare(
        "insert into discord_operator_allowlist (integration_id, workspace_id, principal_type, principal_id, created_at) values (?, ?, 'role', ?, ?)",
      )
      .bind(
        TEST_TOPOLOGY.integrationId,
        TEST_TOPOLOGY.workspaceId,
        TEST_TOPOLOGY.operatorRoleId,
        timestamp,
      ),
  ]);
}

export interface CustomerFixture {
  readonly sessionToken: SessionToken;
  readonly threadId: ThreadId;
}

export async function createCustomerFixture(input?: {
  readonly locale?: string;
}): Promise<CustomerFixture> {
  const app = createHttpApp();
  const apiEnv = createTestEnv();
  const unique = crypto.randomUUID().replaceAll("-", "");
  const headers = {
    "content-type": "application/json",
    origin: TEST_ORIGIN,
  };
  const sessionResponse = await app.request(
    "/v1/client/sessions",
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        inboxId: TEST_TOPOLOGY.inboxId,
        installationId: `installation_${unique}`,
        context: {
          userId: `user_${unique}`,
          email: `${unique}@example.test`,
          posthogDistinctId: `posthog_${unique}`,
          locale: input?.locale ?? "my-MM",
        },
      }),
    },
    apiEnv,
  );
  const session = CreateClientSessionResponseV1Schema.parse(await sessionResponse.json()).session;

  const threadResponse = await app.request(
    "/v1/threads",
    {
      method: "POST",
      headers: { ...headers, authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ clientThreadId: `client_thread_${unique}` }),
    },
    apiEnv,
  );
  const thread = CreateThreadResponseV1Schema.parse(await threadResponse.json()).thread;
  return { sessionToken: session.token, threadId: thread.id };
}

export async function seedReadyDiscordThread(
  threadId: ThreadId,
  database: D1Database = env.DB,
): Promise<void> {
  const timestamp = Date.now();
  await database
    .prepare(
      "insert into discord_thread (thread_id, workspace_id, inbox_id, integration_id, discord_thread_id, state, claim_owner, claim_expires_at, correlation_marker, created_at, updated_at) values (?, ?, ?, ?, ?, 'ready', null, null, ?, ?, ?)",
    )
    .bind(
      threadId,
      TEST_TOPOLOGY.workspaceId,
      TEST_TOPOLOGY.inboxId,
      TEST_TOPOLOGY.integrationId,
      TEST_TOPOLOGY.discordThreadId,
      createDiscordCorrelationMarker(threadId),
      timestamp,
      timestamp,
    )
    .run();
}

export function snowflakeAt(milliseconds = Date.now(), increment = 0n): string {
  const discordEpoch = 1_420_070_400_000n;
  return (((BigInt(milliseconds) - discordEpoch) << 22n) + increment).toString();
}
