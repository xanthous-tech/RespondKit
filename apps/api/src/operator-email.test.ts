import { env, introspectWorkflow } from "cloudflare:test";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { acceptCustomerIngress, acknowledgeCustomerRead } from "@respondkit/conversations";
import { emailConfigurationSchema } from "@respondkit/workspaces";
import {
  createCustomerFixture,
  createTestEnv,
  seedTopology,
  seedReadyDiscordThread,
  TEST_TOPOLOGY,
  TEST_ORIGIN,
} from "../test/fixtures";
import { createDatabase } from "./db";
import { createHttpApp } from "./http";
import { deliverPendingEmails, receiveThreadEmail, type IncomingEmail } from "./email";
import { acceptOperatorEmailIngress, deliverOperatorEmails } from "./operator-email";
import { emailOperatorEnvelopeSchema } from "./workflows/envelope";
import { emailArchiveLinks, emailPreview, emailSource } from "./email-content";

beforeEach(() => seedTopology());
const settings = {
  from: "support@example.com",
  replyDomain: "example.com",
  name: "Example",
  unreadDelaySeconds: 600,
  operator: { forwardTo: "helpdesk@elsewhere.test", allowedReplyFrom: ["operator@elsewhere.test"] },
};
async function setup() {
  await env.DB.prepare("UPDATE inbox SET email_config=? WHERE id=?")
    .bind(JSON.stringify(settings), TEST_TOPOLOGY.inboxId)
    .run();
  const customer = await createCustomerFixture();
  const visitor = await env.DB.prepare("SELECT visitor_id FROM thread WHERE id=?")
    .bind(customer.threadId)
    .first<{ visitor_id: string }>();
  const send = vi.fn().mockResolvedValue({ messageId: "provider-1@example.com" });
  const createBatch = vi.fn().mockResolvedValue([{}]);
  const apiEnv = createTestEnv({
    EMAIL: { send },
    PUBLIC_API_URL: "https://api.example.test",
    ATTACHMENTS: (env as unknown as { ATTACHMENTS: R2Bucket }).ATTACHMENTS,
    MESSAGE_WORKFLOW: { createBatch } as unknown as typeof env.MESSAGE_WORKFLOW,
  });
  async function customerMessage(id = "customer-email-test", text = "Please help with my export") {
    return acceptCustomerIngress(createDatabase(env.DB), {
      id,
      workspaceId: TEST_TOPOLOGY.workspaceId,
      inboxId: TEST_TOPOLOGY.inboxId,
      threadId: customer.threadId,
      clientMessageId: id,
      workflowInstanceId: id,
      acceptedAt: new Date(),
      originalText: text,
    });
  }
  async function operatorRoute() {
    await customerMessage();
    await deliverOperatorEmails(apiEnv);
    return (await env.DB.prepare("SELECT token FROM operator_email_route").first<{
      token: string;
    }>())!.token;
  }
  return {
    ...customer,
    visitorId: visitor!.visitor_id,
    send,
    createBatch,
    apiEnv,
    customerMessage,
    operatorRoute,
  };
}
function incoming(
  token: string,
  options: {
    from?: string;
    headerFrom?: string;
    role?: string;
    sourceId?: string;
    content?: string;
  } = {},
): IncomingEmail {
  const from = options.from ?? "operator@elsewhere.test";
  const sourceId = options.sourceId ?? "<reply@example.test>";
  const to = `${options.role ?? "operator"}+${token}@example.com`;
  const raw = `From: ${options.headerFrom ?? from}\r\nTo: ${to}\r\nMessage-ID: ${sourceId}\r\nMIME-Version: 1.0\r\n${options.content ?? "Content-Type: text/plain; charset=utf-8\r\n\r\nYour export is ready."}`;
  return {
    from,
    to,
    rawSize: new TextEncoder().encode(raw).byteLength,
    raw: new Response(raw).body!,
    headers: new Headers({ "message-id": sourceId }),
    setReject: vi.fn(),
  };
}
const html =
  '<html><body><p>Here is the <a href="https://drive.google.com/example?a=1&amp;b=2">document</a>.</p><script>alert(1)</script></body></html>';
const multipart = `Content-Type: multipart/mixed; boundary="parts"\r\n\r\n--parts\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n--parts\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="report.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\nAAECAwQ=\r\n--parts--`;

it("requires explicit operator destinations and reply senders, with no chat@ default", () => {
  const { operator: _operator, ...base } = settings;
  expect(emailConfigurationSchema.parse(base).operator).toBeUndefined();
  expect(emailConfigurationSchema.safeParse({ ...base, operator: {} }).success).toBe(false);
  expect(
    emailConfigurationSchema.safeParse({
      ...settings,
      operator: { forwardTo: "help@example.com", allowedReplyFrom: [] },
    }).success,
  ).toBe(false);
  expect(
    emailConfigurationSchema.parse({
      ...settings,
      operator: { forwardTo: "Help@Example.com", allowedReplyFrom: ["Owner@Example.com"] },
    }).operator,
  ).toEqual({ forwardTo: "help@example.com", allowedReplyFrom: ["owner@example.com"] });
});
it("queues atomically without Discord and sends once under overlapping cron runs", async () => {
  const f = await setup();
  await f.customerMessage();
  await f.customerMessage();
  expect(await env.DB.prepare("SELECT count(*) AS n FROM operator_email_delivery").first("n")).toBe(
    1,
  );
  expect(await env.DB.prepare("SELECT count(*) AS n FROM discord_thread").first("n")).toBe(0);
  await Promise.all([deliverOperatorEmails(f.apiEnv), deliverOperatorEmails(f.apiEnv)]);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.send.mock.calls[0]?.[0]).toMatchObject({
    from: settings.from,
    to: settings.operator.forwardTo,
    replyTo: expect.stringMatching(/^operator\+[a-f0-9]{32}@example.com$/),
    text: "Please help with my export",
  });
  await f.customerMessage("next-message", "More detail");
  await deliverOperatorEmails(f.apiEnv);
  expect(f.send.mock.calls[1]?.[0].headers).toMatchObject({
    "In-Reply-To": "<provider-1@example.com>",
    References: "<provider-1@example.com>",
  });
});
it("does not backfill old messages when operator mail is enabled", async () => {
  const f = await setup();
  await env.DB.prepare("UPDATE inbox SET email_config=NULL").run();
  await f.customerMessage();
  await env.DB.prepare("UPDATE inbox SET email_config=?").bind(JSON.stringify(settings)).run();
  await deliverOperatorEmails(f.apiEnv);
  expect(f.send).not.toHaveBeenCalled();
});
it("cancels queued notifications after configuration changes and holds ambiguous sends", async () => {
  const f = await setup();
  await f.customerMessage();
  await env.DB.prepare("UPDATE inbox SET email_config=NULL").run();
  await deliverOperatorEmails(f.apiEnv);
  expect(f.send).not.toHaveBeenCalled();
  expect(await env.DB.prepare("SELECT status FROM operator_email_delivery").first("status")).toBe(
    "cancelled",
  );
  await env.DB.prepare("UPDATE inbox SET email_config=?").bind(JSON.stringify(settings)).run();
  await f.customerMessage("second-message");
  f.send.mockRejectedValue(new Error("ambiguous transport failure"));
  await deliverOperatorEmails(f.apiEnv);
  await deliverOperatorEmails(f.apiEnv);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(
    await env.DB.prepare(
      "SELECT status FROM operator_email_delivery WHERE message_id='second-message'",
    ).first("status"),
  ).toBe("unknown");
});
it("preserves original MIME, HTML and binary files, and exposes only download responses", async () => {
  const f = await setup();
  const token = await f.operatorRoute();
  const mail = incoming(token, { content: multipart });
  const raw = await new Response(incoming(token, { content: multipart }).raw).text();
  await receiveThreadEmail(mail, f.apiEnv);
  expect(mail.setReject).not.toHaveBeenCalled();
  const envelope = f.createBatch.mock.calls[0]?.[0][0].params;
  expect(envelope.originalText).toContain("Here is the document.");
  expect(envelope.originalText).not.toContain("alert");
  expect(envelope.originalText).not.toContain("drive.google");
  expect(envelope.attachments).toHaveLength(1);
  const source = (await emailSource(f.apiEnv, envelope.messageId))!;
  expect(await (await f.apiEnv.ATTACHMENTS!.get(source.raw_key))!.text()).toBe(raw);
  expect(await (await f.apiEnv.ATTACHMENTS!.get(source.html_key!))!.text()).toBe(`${html}\n`);
  const app = createHttpApp();
  const response = await app.request(
    `/v1/email-files/${source.download_token}/original.html`,
    {},
    f.apiEnv,
  );
  expect(response.headers.get("content-disposition")).toContain("attachment");
  expect(response.headers.get("content-security-policy")).toContain("sandbox");
  expect(response.headers.get("content-type")).toBe("application/octet-stream");
  expect(await response.text()).toBe(`${html}\n`);
  const binary = await app.request(envelope.attachments[0].downloadUrl, {}, f.apiEnv);
  expect([...new Uint8Array(await binary.arrayBuffer())]).toEqual([0, 1, 2, 3, 4]);
  expect(
    (await app.request(`/v1/email-files/${"f".repeat(64)}/original.html`, {}, f.apiEnv)).status,
  ).toBe(404);
  await receiveThreadEmail(
    incoming(token, { content: "Content-Type: text/plain\r\n\r\nChanged payload" }),
    f.apiEnv,
  );
  expect(f.createBatch.mock.calls[0]).toEqual(f.createBatch.mock.calls[1]);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM attachment").first("n")).toBe(1);
});
it("accepts customer HTML and files and forwards the HTML without link-specific parsing", async () => {
  const f = await setup();
  const token = "a".repeat(32);
  const recipient = await env.DB.prepare("SELECT email FROM visitor WHERE id=?")
    .bind(f.visitorId)
    .first<string>("email");
  await env.DB.prepare("INSERT INTO thread_email_route(token,thread_id,recipient) VALUES (?,?,?)")
    .bind(token, f.threadId, recipient)
    .run();
  await receiveThreadEmail(
    incoming(token, { from: recipient!, role: "reply", content: multipart }),
    f.apiEnv,
  );
  const envelope = f.createBatch.mock.calls[0]?.[0][0].params;
  await acceptCustomerIngress(createDatabase(env.DB), {
    id: envelope.messageId,
    ...envelope,
    acceptedAt: new Date(envelope.acceptedAt),
  });
  await deliverOperatorEmails(f.apiEnv);
  expect(f.send.mock.calls[0]?.[0].html).toContain(html);
  expect(f.send.mock.calls[0]?.[0].text).toContain("report.bin:");
  expect(f.send.mock.calls[0]?.[0].text).toContain("original.eml");
  expect(f.send.mock.calls[0]?.[0].text).toContain("original.html");
});
it("rejects cross-role tokens, wrong senders, header mismatches, robots and closed threads", async () => {
  const f = await setup();
  const token = await f.operatorRoute();
  for (const options of [
    { role: "reply" },
    { from: "attacker@example.test" },
    { headerFrom: "attacker@example.test" },
  ]) {
    const mail = incoming(token, options);
    await receiveThreadEmail(mail, f.apiEnv);
    expect(mail.setReject).toHaveBeenCalled();
  }
  const robot = incoming(token);
  robot.headers.set("auto-submitted", "auto-replied");
  await receiveThreadEmail(robot, f.apiEnv);
  expect(robot.setReject).toHaveBeenCalled();
  await env.DB.prepare("UPDATE thread SET status='closed' WHERE id=?").bind(f.threadId).run();
  const closed = incoming(token);
  await receiveThreadEmail(closed, f.apiEnv);
  expect(closed.setReject).toHaveBeenCalled();
  expect(f.createBatch).not.toHaveBeenCalled();
});
it("revokes old operator routes and accepted-but-not-started workflows when settings change", async () => {
  const f = await setup();
  const token = await f.operatorRoute();
  await receiveThreadEmail(incoming(token), f.apiEnv);
  const envelope = emailOperatorEnvelopeSchema.parse(f.createBatch.mock.calls[0]?.[0][0].params);
  await env.DB.prepare("UPDATE inbox SET email_config=?")
    .bind(
      JSON.stringify({
        ...settings,
        operator: { ...settings.operator, allowedReplyFrom: ["new@example.test"] },
      }),
    )
    .run();
  await expect(acceptOperatorEmailIngress(f.apiEnv, envelope)).rejects.toThrow("authorization");
  const revoked = incoming(token);
  await receiveThreadEmail(revoked, f.apiEnv);
  expect(revoked.setReject).toHaveBeenCalled();
});
it("bounds previews without discarding the source and excludes script/style text", async () => {
  expect(await emailPreview({ html: "<p>A &amp; B &#x1F600;</p>" })).toBe("A & B 😀");
  expect((await emailPreview({ text: "x".repeat(9000) })).length).toBeLessThanOrEqual(6000);
  expect(
    await emailPreview({ html: "<head><style>bad</style></head><p>Hello</p><p>World</p>" }),
  ).toBe("Hello\nWorld");
});
it("publishes an operator email through the real workflow, mirrors its archive to Discord and cancels unread mail on read", async () => {
  const f = await setup();
  const token = await f.operatorRoute();
  await seedReadyDiscordThread(f.threadId);
  const posts: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (_request, init) => {
      if (init?.method === "GET") return Response.json([]);
      if (init?.method !== "POST" || typeof init.body !== "string")
        throw new Error("Unexpected Discord request");
      const body = JSON.parse(init.body) as { content: string; nonce: string };
      posts.push(body.content);
      return Response.json({
        id: "1554171622695501925",
        channel_id: TEST_TOPOLOGY.discordThreadId,
        content: body.content,
        nonce: body.nonce,
      });
    }),
  );
  const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
  try {
    await workflows.modifyAll(async (modifier) => modifier.disableRetryDelays());
    const mail = incoming(token, { content: multipart });
    await receiveThreadEmail(mail, { ...f.apiEnv, MESSAGE_WORKFLOW: env.MESSAGE_WORKFLOW });
    expect(mail.setReject).not.toHaveBeenCalled();
    const instances = await workflows.get();
    expect(instances).toHaveLength(1);
    await instances[0]!.waitForStatus("complete");
    const response = await createHttpApp().request(
      `/v1/threads/${f.threadId}/messages`,
      { headers: { authorization: `Bearer ${f.sessionToken}`, origin: TEST_ORIGIN } },
      f.apiEnv,
    );
    const transcript = await response.text();
    expect(transcript).toContain("Here is the document.");
    expect(transcript).toContain("report.bin");
    expect(transcript).not.toContain("original.eml");
    expect(posts.join("\n")).toContain("original.html");
    expect(posts.join("\n")).toContain("report.bin");
    const delivery = (await env.DB.prepare(
      "SELECT due_at,transcript_cursor FROM email_delivery",
    ).first<{ due_at: number; transcript_cursor: number }>())!;
    expect(delivery.due_at).toBeGreaterThan(Date.now() + 590_000);
    await acknowledgeCustomerRead(createDatabase(env.DB), {
      workspaceId: TEST_TOPOLOGY.workspaceId,
      inboxId: TEST_TOPOLOGY.inboxId,
      threadId: f.threadId,
      cursor: String(delivery.transcript_cursor),
    });
    await env.DB.prepare("UPDATE email_delivery SET due_at=0").run();
    f.send.mockClear();
    await deliverPendingEmails(f.apiEnv);
    expect(f.send).not.toHaveBeenCalled();
    const source = await env.DB.prepare("SELECT message_id FROM email_source").first<{
      message_id: string;
    }>();
    expect(await emailArchiveLinks(f.apiEnv, source!.message_id)).toContain("original.eml");
  } finally {
    await workflows.dispose();
  }
});

it("keeps first MIME and file ownership under concurrent duplicate ingress", async () => {
  const f = await setup();
  const token = await f.operatorRoute();
  await Promise.all([
    receiveThreadEmail(incoming(token, { content: multipart }), f.apiEnv),
    receiveThreadEmail(incoming(token, { content: multipart }), f.apiEnv),
  ]);
  expect(f.createBatch).toHaveBeenCalledTimes(2);
  expect(f.createBatch.mock.calls[0]).toEqual(f.createBatch.mock.calls[1]);
  expect(await env.DB.prepare("SELECT count(*) AS n FROM email_source").first("n")).toBe(1);
  expect(
    await env.DB.prepare("SELECT count(*) AS n FROM attachment WHERE status='ready'").first("n"),
  ).toBe(1);
});
it("allows replies for app customers without email and keeps operator addresses private", async () => {
  const f = await setup();
  await env.DB.prepare("UPDATE visitor SET email=NULL WHERE id=?").bind(f.visitorId).run();
  const token = await f.operatorRoute();
  await receiveThreadEmail(
    incoming(token, {
      content: `Content-Type: text/plain\r\n\r\nHello!\nOn Monday operator+${token}@example.com wrote:`,
    }),
    f.apiEnv,
  );
  const envelope = emailOperatorEnvelopeSchema.parse(f.createBatch.mock.calls[0]?.[0][0].params);
  expect(envelope.originalText).not.toContain(token);
  expect(envelope.originalText).toContain("Hello!");
  const accepted = await acceptOperatorEmailIngress(f.apiEnv, envelope);
  expect(accepted.message.threadId).toBe(f.threadId);
  expect(accepted.message.direction).toBe("operator_to_customer");
  expect(await env.DB.prepare("SELECT count(*) AS n FROM discord_interaction").first("n")).toBe(0);
});
it("accepts large emails while bounding the preview, and falls back to archive links for oversized outbound HTML", async () => {
  const f = await setup();
  const token = "b".repeat(32);
  const recipient = await env.DB.prepare("SELECT email FROM visitor WHERE id=?")
    .bind(f.visitorId)
    .first<string>("email");
  await env.DB.prepare("INSERT INTO thread_email_route(token,thread_id,recipient) VALUES (?,?,?)")
    .bind(token, f.threadId, recipient)
    .run();
  const mail = incoming(token, {
    from: recipient!,
    role: "reply",
    content: `Content-Type: text/html\r\n\r\n<p>${"x".repeat(1100000)}</p>`,
  });
  await receiveThreadEmail(mail, f.apiEnv);
  expect(mail.setReject).not.toHaveBeenCalled();
  const envelope = f.createBatch.mock.calls[0]?.[0][0].params;
  expect(envelope.originalText.length).toBeLessThanOrEqual(6000);
  await acceptCustomerIngress(createDatabase(env.DB), {
    id: envelope.messageId,
    ...envelope,
    acceptedAt: new Date(envelope.acceptedAt),
  });
  await deliverOperatorEmails(f.apiEnv);
  expect(f.send.mock.calls[0]?.[0].html).toBeUndefined();
  expect(f.send.mock.calls[0]?.[0].text).toContain("original.html");
});
