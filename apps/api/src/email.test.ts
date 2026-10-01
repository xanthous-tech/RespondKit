import { env } from "cloudflare:test";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { acceptReplyIngress } from "@respondkit/discord";
import { publishUntranslatedReply } from "@respondkit/conversations";
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
  [TEST_TOPOLOGY.inboxId]: {
    from: "support@example.com",
    replyDomain: "reply.example.com",
    name: "Example",
  },
});
async function queued() {
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
    EMAIL_INBOXES: config,
    EMAIL: { send },
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
      headers: new Headers(),
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
