import { env } from "cloudflare:test";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { acceptReplyIngress } from "@respondkit/discord";
import { acknowledgeCustomerRead, publishUntranslatedReply } from "@respondkit/conversations";
import {
  createCustomerFixture,
  createTestEnv,
  seedTopology,
  seedReadyDiscordThread,
  TEST_TOPOLOGY,
} from "../test/fixtures";
import { createDatabase } from "./db";
import {
  deliverPendingEmails,
  enqueueReplyEmail,
  receiveThreadEmail,
  type IncomingEmail,
} from "./email";

beforeEach(() => seedTopology());
const config = JSON.stringify({
  from: "support@example.com",
  replyDomain: "reply.example.com",
  name: "Example",
});
async function queued() {
  await env.DB.prepare("UPDATE inbox SET email_config=? WHERE id=?")
    .bind(config, TEST_TOPOLOGY.inboxId)
    .run();
  const { threadId } = await createCustomerFixture();
  await seedReadyDiscordThread(threadId);
  const scope = {
    workspaceId: TEST_TOPOLOGY.workspaceId,
    inboxId: TEST_TOPOLOGY.inboxId,
    threadId,
    messageId: "msg_email_test",
  };
  await acceptReplyIngress(createDatabase(env.DB), {
    ...scope,
    integrationId: TEST_TOPOLOGY.integrationId,
    interactionId: "123456789",
    workflowInstanceId: "operator_email_test",
    applicationId: TEST_TOPOLOGY.applicationId,
    guildId: TEST_TOPOLOGY.guildId,
    discordThreadId: TEST_TOPOLOGY.discordThreadId,
    operatorUserId: TEST_TOPOLOGY.operatorId,
    operatorRoleIds: [TEST_TOPOLOGY.operatorRoleId],
    acceptedAt: new Date(),
    originalEnglishText: "Your export is ready.",
    replyTranslation: "off",
  });
  await publishUntranslatedReply(createDatabase(env.DB), {
    ...scope,
    generation: 1,
    transitionedAt: new Date(),
  });
  const send = vi.fn().mockResolvedValue({ messageId: "provider-123" });
  const apiEnv = createTestEnv({
    EMAIL: { send },
    ATTACHMENTS: (env as unknown as { ATTACHMENTS: R2Bucket }).ATTACHMENTS,
    PUBLIC_API_URL: "https://api.example.test",
  });
  await enqueueReplyEmail(apiEnv, scope.messageId);
  await enqueueReplyEmail(apiEnv, scope.messageId);
  const route = await env.DB.prepare("SELECT * FROM thread_email_route").first<{
    token: string;
    recipient: string;
  }>();
  return { apiEnv, send, route: route!, threadId };
}
it("queues once, sends customer-visible text once, and records provider acceptance", async () => {
  const { apiEnv, send } = await queued();
  await makeDue();
  await deliverPendingEmails(apiEnv);
  await deliverPendingEmails(apiEnv);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ text: "Your export is ready.", from: "support@example.com" }),
  );
  expect(await env.DB.prepare("SELECT status, provider_id FROM email_delivery").first()).toEqual({
    status: "sent",
    provider_id: "provider-123",
  });
});
it("holds ambiguous delivery instead of sending duplicates", async () => {
  const { apiEnv, send } = await queued();
  vi.mocked(send).mockRejectedValue(new Error("connection lost"));
  await makeDue();
  await deliverPendingEmails(apiEnv);
  await deliverPendingEmails(apiEnv);
  expect(send).toHaveBeenCalledTimes(1);
  expect(await env.DB.prepare("SELECT status FROM email_delivery").first()).toEqual({
    status: "unknown",
  });
});
it("routes replies to the same thread with stable ingress and rejects other senders", async () => {
  const { apiEnv, route, threadId } = await queued();
  const createBatch = vi.fn().mockResolvedValue([{}]);
  const binding = { createBatch } as unknown as typeof apiEnv.MESSAGE_WORKFLOW;
  const raw = `From: ${route.recipient}\r\nTo: reply+${route.token}@reply.example.com\r\nMessage-ID: <one@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nThank you!`;
  function incoming(from = route.recipient): IncomingEmail {
    return {
      from,
      to: `reply+${route.token}@reply.example.com`,
      rawSize: raw.length,
      raw: new Response(raw).body!,
      headers: new Headers({ "message-id": "<one@example.test>" }),
      setReject: vi.fn(),
    };
  }
  await receiveThreadEmail(incoming(), { ...apiEnv, MESSAGE_WORKFLOW: binding });
  await receiveThreadEmail(incoming(), { ...apiEnv, MESSAGE_WORKFLOW: binding });
  expect(createBatch.mock.calls[0]).toEqual(createBatch.mock.calls[1]);
  expect(createBatch.mock.calls[0]?.[0][0].params).toMatchObject({
    threadId,
    originalText: "Thank you!",
  });
  const attacker = incoming("other@example.test");
  await receiveThreadEmail(attacker, apiEnv);
  expect(attacker.setReject).toHaveBeenCalled();
  const robot = incoming();
  robot.headers.set("auto-submitted", "auto-replied");
  await receiveThreadEmail(robot, apiEnv);
  expect(robot.setReject).toHaveBeenCalled();
});
it("does nothing when email is disabled or the customer has no address", async () => {
  const { apiEnv, send } = await queued();
  await env.DB.prepare("DELETE FROM email_delivery").run();
  await env.DB.prepare("UPDATE visitor SET email = NULL").run();
  await enqueueReplyEmail(apiEnv, "msg_email_test");
  await deliverPendingEmails(apiEnv);
  expect(send).not.toHaveBeenCalled();
});

async function makeDue() {
  await env.DB.prepare("UPDATE email_delivery SET due_at=?")
    .bind(Date.now() - 1)
    .run();
}
it("waits ten minutes from publication and does not reset the deadline on retry", async () => {
  const { apiEnv, send } = await queued();
  const row = await env.DB.prepare(
    "SELECT d.due_at,e.event_at FROM email_delivery d JOIN customer_transcript_entry e ON e.row_id=d.transcript_cursor",
  ).first<{ due_at: number; event_at: number }>();
  expect(row!.due_at - row!.event_at).toBe(600000);
  await enqueueReplyEmail(apiEnv, "msg_email_test");
  expect(await env.DB.prepare("SELECT due_at FROM email_delivery").first("due_at")).toBe(
    row!.due_at,
  );
  await deliverPendingEmails(apiEnv);
  expect(send).not.toHaveBeenCalled();
});
it("cancels durably when a client reads, including reads before enqueue", async () => {
  const { apiEnv, send, threadId } = await queued();
  const cursor = String(
    await env.DB.prepare("SELECT transcript_cursor FROM email_delivery").first("transcript_cursor"),
  );
  await acknowledgeCustomerRead(createDatabase(env.DB), {
    workspaceId: TEST_TOPOLOGY.workspaceId,
    inboxId: TEST_TOPOLOGY.inboxId,
    threadId,
    cursor,
  });
  expect(await env.DB.prepare("SELECT status FROM email_delivery").first("status")).toBe(
    "cancelled",
  );
  await env.DB.prepare("DELETE FROM email_delivery").run();
  await enqueueReplyEmail(apiEnv, "msg_email_test");
  expect(await env.DB.prepare("SELECT status FROM email_delivery").first("status")).toBe(
    "cancelled",
  );
  await makeDue();
  await deliverPendingEmails(apiEnv);
  expect(send).not.toHaveBeenCalled();
});
it("batches overdue replies, leaves newer replies pending, and avoids concurrent duplicates", async () => {
  const { apiEnv, send } = await queued();
  await makeDue();
  // Separate canonical IDs mimic additional published replies, with the same route and deadline.
  await env.DB.prepare(`INSERT INTO email_delivery (message_id,route_token,sender,reply_to,subject,body,updated_at,due_at,transcript_cursor)
    SELECT 'second',route_token,sender,reply_to,subject,'Second reply',updated_at,due_at,transcript_cursor FROM email_delivery`).run();
  await env.DB.prepare(`INSERT INTO email_delivery (message_id,route_token,sender,reply_to,subject,body,updated_at,due_at,transcript_cursor)
    SELECT 'newer',route_token,sender,reply_to,subject,'New reply',updated_at,?,transcript_cursor FROM email_delivery LIMIT 1`)
    .bind(Date.now() + 600000)
    .run();
  await Promise.all([deliverPendingEmails(apiEnv), deliverPendingEmails(apiEnv)]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[0].text).toContain("Second reply");
  expect(send.mock.calls[0]?.[0].text).not.toContain("New reply");
  expect(
    await env.DB.prepare("SELECT status FROM email_delivery WHERE message_id='newer'").first(
      "status",
    ),
  ).toBe("pending");
});
it("suppresses a queued delivery to an address the customer has replaced", async () => {
  const { apiEnv, send } = await queued();
  await makeDue();
  await env.DB.prepare("UPDATE visitor SET email='new@example.com'").run();
  await deliverPendingEmails(apiEnv);
  expect(send).not.toHaveBeenCalled();
  expect(await env.DB.prepare("SELECT status FROM email_delivery").first("status")).toBe(
    "cancelled",
  );
});
