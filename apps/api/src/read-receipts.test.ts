import { acceptReplyIngress, DiscordRestClient, DiscordRestError } from "@respondkit/discord";
import { publishOperatorReply } from "@respondkit/conversations";
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { createDatabase } from "./db";
import { createHttpApp } from "./http";
import { deriveOperatorMessageIdentity } from "./identity";
import { syncDiscordReadReceipts } from "./read-receipts";
import {
  createCustomerFixture,
  createTestEnv,
  seedTopology,
  seedReadyDiscordThread,
  snowflakeAt,
  TEST_ORIGIN,
  TEST_TOPOLOGY,
} from "../test/fixtures";

beforeEach(async () => {
  await seedTopology();
});
afterEach(() => vi.restoreAllMocks());

async function setup() {
  const customer = await createCustomerFixture();
  await seedReadyDiscordThread(customer.threadId);
  const db = createDatabase(env.DB);
  async function reply(index: number, project = true) {
    const interactionId = snowflakeAt(Date.now(), BigInt(index));
    const identity = await deriveOperatorMessageIdentity({
      applicationId: TEST_TOPOLOGY.applicationId,
      interactionId,
    });
    await acceptReplyIngress(db, {
      ...TEST_TOPOLOGY,
      ...identity,
      interactionId,
      threadId: customer.threadId,
      operatorUserId: TEST_TOPOLOGY.operatorId,
      operatorRoleIds: [],
      acceptedAt: new Date(),
      originalEnglishText: `Reply ${index}`,
    });
    await publishOperatorReply(db, {
      ...TEST_TOPOLOGY,
      threadId: customer.threadId,
      messageId: identity.messageId,
      id: `translation_${identity.messageId}`,
      generation: 1,
      sourceLanguage: "en",
      targetLanguage: "en",
      translatedText: `Reply ${index}`,
      promptVersion: "test",
      provider: "test",
      model: "test",
      isPassThrough: true,
      mixedLanguage: false,
      needsReview: false,
      translatedAt: new Date(),
    });
    const discordMessageId = `1000000000000000${index.toString().padStart(2, "0")}`;
    await env.DB.prepare(`insert into discord_message (workspace_id,inbox_id,thread_id,message_id,integration_id,projection_kind,chunk_index,nonce,correlation_marker,discord_thread_id,discord_message_id,status)
      values (?,?,?,?,?,'available_audit',0,?,?,?,?,?)`)
      .bind(
        TEST_TOPOLOGY.workspaceId,
        TEST_TOPOLOGY.inboxId,
        customer.threadId,
        identity.messageId,
        TEST_TOPOLOGY.integrationId,
        String(index),
        `marker_${index}`,
        TEST_TOPOLOGY.discordThreadId,
        project ? discordMessageId : null,
        project ? "sent" : "pending",
      )
      .run();
    const cursor = await env.DB.prepare(
      "select row_id from customer_transcript_entry where message_id = ? and event_kind = 'available'",
    )
      .bind(identity.messageId)
      .first<number>("row_id");
    return { cursor: String(cursor), discordMessageId, messageId: identity.messageId };
  }
  return { customer, reply };
}
async function acknowledge(threadId: string, token: string, cursor: string) {
  const ctx = createExecutionContext();
  const response = await createHttpApp().request(
    `/v1/threads/${threadId}/read`,
    {
      method: "POST",
      headers: {
        origin: TEST_ORIGIN,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ cursor }),
    },
    createTestEnv(),
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

it("adds one checkmark only to read replies, keeps the cursor monotonic, and rejects future cursors", async () => {
  const { customer, reply } = await setup();
  const first = await reply(1),
    second = await reply(2);
  const react = vi.spyOn(DiscordRestClient.prototype, "addReadReaction").mockResolvedValue();
  expect((await acknowledge(customer.threadId, customer.sessionToken, first.cursor)).status).toBe(
    200,
  );
  expect(react).toHaveBeenCalledExactlyOnceWith(
    TEST_TOPOLOGY.discordThreadId,
    first.discordMessageId,
  );
  expect((await acknowledge(customer.threadId, customer.sessionToken, "999999")).status).toBe(400);
  expect((await acknowledge(customer.threadId, customer.sessionToken, second.cursor)).status).toBe(
    200,
  );
  expect(react).toHaveBeenLastCalledWith(TEST_TOPOLOGY.discordThreadId, second.discordMessageId);
  await acknowledge(customer.threadId, customer.sessionToken, first.cursor);
  await syncDiscordReadReceipts(createTestEnv());
  expect(react).toHaveBeenCalledTimes(2);
  expect(
    await env.DB.prepare("select customer_read_cursor from thread where id = ?")
      .bind(customer.threadId)
      .first("customer_read_cursor"),
  ).toBe(Number(second.cursor));
});

it("rejects another customer's receipt and cursors from a different thread", async () => {
  const { customer, reply } = await setup();
  const first = await reply(1);
  const other = await createCustomerFixture();
  expect((await acknowledge(customer.threadId, other.sessionToken, first.cursor)).status).toBe(404);
  expect((await acknowledge(other.threadId, other.sessionToken, first.cursor)).status).toBe(400);
  expect((await acknowledge(customer.threadId, "invalid_session_token", first.cursor)).status).toBe(
    401,
  );
});

it("recovers a read that arrived before the audit and retries Discord failures without rereading", async () => {
  const { customer, reply } = await setup();
  const first = await reply(1, false);
  const react = vi
    .spyOn(DiscordRestClient.prototype, "addReadReaction")
    .mockRejectedValueOnce(
      new DiscordRestError({
        message: "rate limited",
        method: "PUT",
        path: "/reaction",
        status: 429,
        retryable: true,
        retryAfterMs: 120_000,
      }),
    )
    .mockResolvedValue();
  await acknowledge(customer.threadId, customer.sessionToken, first.cursor);
  expect(react).not.toHaveBeenCalled();
  await env.DB.prepare(
    "update discord_message set status = 'sent', discord_message_id = ? where message_id = ?",
  )
    .bind(first.discordMessageId, first.messageId)
    .run();
  await syncDiscordReadReceipts(createTestEnv());
  expect(react).toHaveBeenCalledTimes(1);
  const retry = await env.DB.prepare(
    "select read_reaction_retry_at from discord_message where message_id = ?",
  )
    .bind(first.messageId)
    .first<number>("read_reaction_retry_at");
  expect(retry).toBeGreaterThan(Date.now() + 110_000);
  await syncDiscordReadReceipts(createTestEnv());
  expect(react).toHaveBeenCalledTimes(1);
  await env.DB.prepare("update discord_message set read_reaction_retry_at = 0").run();
  await syncDiscordReadReceipts(createTestEnv());
  expect(react).toHaveBeenCalledTimes(2);
  expect(
    await env.DB.prepare("select read_reaction_at from discord_message where message_id = ?")
      .bind(first.messageId)
      .first("read_reaction_at"),
  ).toBeTypeOf("number");
});
