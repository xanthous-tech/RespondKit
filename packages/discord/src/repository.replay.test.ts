import type {
  InboxId,
  MessageId,
  ThreadId,
  WorkflowInstanceId,
  WorkspaceId,
} from "@agent-chat/protocol";
import { DatabaseSync } from "node:sqlite";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  drizzle,
  type AsyncBatchRemoteCallback,
  type RemoteCallback,
} from "drizzle-orm/sqlite-proxy";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  acceptReplyIngress,
  recordRecoveryInteraction,
  type DiscordRecoveryInteractionInput,
  type DiscordReplyIngressInput,
} from "./repository";

const workspaceId = "workspace_1" as WorkspaceId;
const inboxId = "inbox_1" as InboxId;
const threadId = "thread_1" as ThreadId;

const openDatabases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
});

function createTestDatabase(): DrizzleD1Database {
  const database = new DatabaseSync(":memory:");
  openDatabases.push(database);
  database.exec(`
    create table thread (
      id text primary key not null,
      workspace_id text not null,
      inbox_id text not null,
      last_activity_at integer not null,
      updated_at integer not null
    );
    create table message (
      row_id integer primary key autoincrement not null,
      id text not null,
      workspace_id text not null,
      inbox_id text not null,
      thread_id text not null,
      client_message_id text,
      workflow_instance_id text not null,
      direction text not null,
      original_text text not null,
      original_language text,
      customer_visible_text text,
      customer_visible_language text,
      operator_visible_text text,
      accepted_at integer not null,
      processing_generation integer default 1 not null,
      processing_status text default 'processing' not null,
      customer_availability text default 'pending' not null,
      operator_projection_status text default 'not_applicable' not null,
      discord_audit_status text default 'not_applicable' not null,
      failure_stage text,
      failure_code text,
      created_at integer not null,
      updated_at integer not null
    );
    create unique index message_id_uq on message (id);
    create unique index message_workflow_instance_uq on message (workflow_instance_id);
    create unique index message_thread_client_id_uq
      on message (workspace_id, thread_id, client_message_id);
    create table discord_interaction (
      integration_id text not null,
      interaction_id text not null,
      workspace_id text not null,
      inbox_id text not null,
      thread_id text not null,
      message_id text,
      application_id text not null,
      guild_id text not null,
      discord_thread_id text not null,
      operator_user_id text not null,
      operator_role_ids text default '[]' not null,
      command_name text not null,
      reference_interaction_id text,
      normalized_message text,
      accepted_at integer not null,
      created_at integer not null,
      primary key (integration_id, interaction_id)
    );
    create unique index discord_interaction_message_uq on discord_interaction (message_id);
    insert into thread (id, workspace_id, inbox_id, last_activity_at, updated_at)
      values ('thread_1', 'workspace_1', 'inbox_1', 0, 0);
  `);

  const execute = (query: Parameters<AsyncBatchRemoteCallback>[0][number]): { rows: unknown[] } => {
    const statement = database.prepare(query.sql);
    statement.setReturnArrays(true);
    if (query.method === "run") {
      statement.run(...query.params);
      return { rows: [] };
    }
    if (query.method === "get") {
      return { rows: (statement.get(...query.params) as unknown[] | undefined) ?? [] };
    }
    return { rows: statement.all(...query.params) as unknown as unknown[][] };
  };

  const callback: RemoteCallback = async (sql, params, method) => execute({ sql, params, method });
  const batchCallback: AsyncBatchRemoteCallback = async (batch) => {
    database.exec("begin");
    try {
      const results = batch.map(execute);
      database.exec("commit");
      return results;
    } catch (error) {
      database.exec("rollback");
      throw error;
    }
  };

  return drizzle(callback, batchCallback) as unknown as DrizzleD1Database;
}

function replyInput(acceptedAt: Date): DiscordReplyIngressInput {
  return {
    integrationId: "integration_1",
    interactionId: "interaction_reply_1",
    workspaceId,
    inboxId,
    threadId,
    messageId: "message_1" as MessageId,
    workflowInstanceId: "workflow_1" as WorkflowInstanceId,
    applicationId: "application_1",
    guildId: "guild_1",
    discordThreadId: "discord_thread_1",
    operatorUserId: "operator_1",
    operatorRoleIds: ["role_2", "role_1"],
    acceptedAt,
    originalEnglishText: "How can I help?",
  };
}

describe("Discord interaction timestamp replay", () => {
  it("accepts a replayed reply with a later observation time and returns canonical timestamps", async () => {
    const db = createTestDatabase();
    const firstAcceptedAt = new Date(1_000);
    const initial = await acceptReplyIngress(db, replyInput(firstAcceptedAt));
    expect(initial.kind).toBe("inserted");

    const replay = await acceptReplyIngress(db, replyInput(new Date(99_000)));
    expect(replay).toMatchObject({
      kind: "existing",
      immutablePayloadMatches: true,
    });
    expect(replay.interaction.acceptedAt).toEqual(firstAcceptedAt);
    expect(replay.message.acceptedAt).toEqual(firstAcceptedAt);

    const changedPayload = await acceptReplyIngress(db, {
      ...replyInput(new Date(100_000)),
      originalEnglishText: "This changed",
    });
    expect(changedPayload.immutablePayloadMatches).toBe(false);
    expect(changedPayload.interaction.acceptedAt).toEqual(firstAcceptedAt);
  });

  it.each(["status", "retry"] as const)(
    "accepts a replayed /%s recovery command with a later observation time",
    async (commandName) => {
      const db = createTestDatabase();
      const firstAcceptedAt = new Date(2_000);
      const common = {
        integrationId: "integration_1",
        interactionId: `interaction_${commandName}_1`,
        workspaceId,
        inboxId,
        threadId,
        applicationId: "application_1",
        guildId: "guild_1",
        discordThreadId: "discord_thread_1",
        operatorUserId: "operator_1",
        operatorRoleIds: ["role_2", "role_1"],
        referenceInteractionId: "interaction_reply_1",
      } as const;
      const input: DiscordRecoveryInteractionInput =
        commandName === "retry"
          ? {
              ...common,
              commandName,
              originalEnglishText: "How can I help?",
              acceptedAt: firstAcceptedAt,
            }
          : { ...common, commandName, acceptedAt: firstAcceptedAt };

      const initial = await recordRecoveryInteraction(db, input);
      expect(initial.inserted).toBe(true);

      const replay = await recordRecoveryInteraction(db, {
        ...input,
        acceptedAt: new Date(200_000),
      });
      expect(replay).toMatchObject({
        inserted: false,
        immutablePayloadMatches: true,
      });
      expect(replay.interaction.acceptedAt).toEqual(firstAcceptedAt);
    },
  );
});
