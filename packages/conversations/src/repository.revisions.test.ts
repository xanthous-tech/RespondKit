import type {
  ClientMessageId,
  Cursor,
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
  acceptCustomerIngress,
  listCustomerMessages,
  markCustomerMessageProjected,
  recordTerminalFailure,
  reopenMessageForRetry,
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
    create table customer_transcript_entry (
      row_id integer primary key autoincrement not null,
      workspace_id text not null,
      inbox_id text not null,
      thread_id text not null,
      message_id text not null,
      processing_generation integer not null,
      event_kind text not null,
      event_at integer not null
    );
    create unique index customer_transcript_entry_revision_uq
      on customer_transcript_entry (message_id, processing_generation, event_kind);
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

function customerIngress(messageNumber: number, acceptedAt: Date) {
  return {
    id: `message_${messageNumber}` as MessageId,
    workspaceId,
    inboxId,
    threadId,
    clientMessageId: `client_message_${messageNumber}` as ClientMessageId,
    workflowInstanceId: `workflow_${messageNumber}` as WorkflowInstanceId,
    acceptedAt,
    originalText: `Customer message ${messageNumber}`,
    localeHint: "th",
  };
}

describe("customer transcript revisions", () => {
  it("emits processing at ingress and the same message ID as available at a later cursor", async () => {
    const db = createTestDatabase();
    const ingress = customerIngress(1, new Date(1_000));

    const accepted = await acceptCustomerIngress(db, ingress);
    expect(accepted.immutablePayloadMatches).toBe(true);
    const processingPage = await listCustomerMessages(db, {
      workspaceId,
      inboxId,
      threadId,
    });
    expect(processingPage.messages).toEqual([
      expect.objectContaining({ id: ingress.id, state: "processing" }),
    ]);

    const replay = await acceptCustomerIngress(db, {
      ...ingress,
      acceptedAt: new Date(99_000),
    });
    expect(replay.immutablePayloadMatches).toBe(true);
    expect(replay.message.acceptedAt).toEqual(ingress.acceptedAt);
    await expect(
      listCustomerMessages(db, {
        workspaceId,
        inboxId,
        threadId,
        after: processingPage.nextCursor,
      }),
    ).resolves.toMatchObject({ messages: [] });

    await markCustomerMessageProjected(db, {
      workspaceId,
      inboxId,
      threadId,
      messageId: ingress.id,
      generation: 1,
      transitionedAt: new Date(2_000),
    });
    const availablePage = await listCustomerMessages(db, {
      workspaceId,
      inboxId,
      threadId,
      after: processingPage.nextCursor,
    });
    expect(availablePage.messages).toEqual([
      expect.objectContaining({ id: ingress.id, state: "available" }),
    ]);
    expect(availablePage.nextCursor).not.toBe(processingPage.nextCursor);

    await markCustomerMessageProjected(db, {
      workspaceId,
      inboxId,
      threadId,
      messageId: ingress.id,
      generation: 1,
      transitionedAt: new Date(2_000),
    });
    await expect(
      listCustomerMessages(db, {
        workspaceId,
        inboxId,
        threadId,
        after: availablePage.nextCursor,
      }),
    ).resolves.toMatchObject({ messages: [] });
  });

  it("emits failed and retry-processing revisions once per processing generation", async () => {
    const db = createTestDatabase();
    const ingress = customerIngress(2, new Date(1_000));
    await acceptCustomerIngress(db, ingress);
    const ingressPage = await listCustomerMessages(db, {
      workspaceId,
      inboxId,
      threadId,
    });

    const failure = {
      workspaceId,
      inboxId,
      threadId,
      messageId: ingress.id,
      generation: 1,
      transitionedAt: new Date(2_000),
      stage: "translation" as const,
      failureCode: "translation_failed",
    };
    await recordTerminalFailure(db, failure);
    const failedPage = await listCustomerMessages(db, {
      workspaceId,
      inboxId,
      threadId,
      after: ingressPage.nextCursor,
    });
    expect(failedPage.messages).toEqual([
      expect.objectContaining({ id: ingress.id, state: "failed" }),
    ]);

    await recordTerminalFailure(db, failure);
    await expect(
      listCustomerMessages(db, {
        workspaceId,
        inboxId,
        threadId,
        after: failedPage.nextCursor,
      }),
    ).resolves.toMatchObject({ messages: [] });

    await reopenMessageForRetry(db, {
      workspaceId,
      inboxId,
      threadId,
      messageId: ingress.id,
      generation: 1,
      reopenedAt: new Date(3_000),
    });
    const retryPage = await listCustomerMessages(db, {
      workspaceId,
      inboxId,
      threadId,
      after: failedPage.nextCursor,
    });
    expect(retryPage.messages).toEqual([
      expect.objectContaining({ id: ingress.id, state: "processing" }),
    ]);

    await reopenMessageForRetry(db, {
      workspaceId,
      inboxId,
      threadId,
      messageId: ingress.id,
      generation: 1,
      reopenedAt: new Date(30_000),
    });
    await recordTerminalFailure(db, {
      ...failure,
      generation: 2,
      transitionedAt: new Date(4_000),
    });
    const secondFailurePage = await listCustomerMessages(db, {
      workspaceId,
      inboxId,
      threadId,
      after: retryPage.nextCursor,
    });
    expect(secondFailurePage.messages).toEqual([
      expect.objectContaining({ id: ingress.id, state: "failed" }),
    ]);

    const allRevisions = await listCustomerMessages(db, {
      workspaceId,
      inboxId,
      threadId,
      after: "0" as Cursor,
    });
    expect(allRevisions.messages.map(({ id, state }) => [id, state])).toEqual([
      [ingress.id, "processing"],
      [ingress.id, "failed"],
      [ingress.id, "processing"],
      [ingress.id, "failed"],
    ]);
  });
});
