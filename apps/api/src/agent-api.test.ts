import {
  acceptCustomerIngress,
  acceptOperatorIngress,
  publishUntranslatedReply,
} from "@respondkit/conversations";
import { env, introspectWorkflow } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  createCustomerFixture,
  createTestEnv,
  seedReadyDiscordThread,
  seedTopology,
  TEST_ORIGIN,
  TEST_TOPOLOGY,
} from "../test/fixtures";
import { acceptAgentIngress, agentTokenHash } from "./agent-api";
import { createDatabase } from "./db";
import type { Env } from "./env";
import { createHttpApp } from "./http";

const token = "test-only-agent-token-not-a-production-secret";
let apiEnv: Env;
const app = createHttpApp();

beforeEach(async () => {
  await seedTopology();
  apiEnv = createTestEnv({
    [`AGENT_TOKEN_${TEST_TOPOLOGY.inboxId}`]: await agentTokenHash(token),
    [`AGENT_NAME_${TEST_TOPOLOGY.inboxId}`]: "Helper",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function request(path: string, body?: unknown, overrides: Partial<Env> = {}) {
  return app.request(
    `/v1/agent${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    { ...apiEnv, ...overrides },
  );
}

async function customerMessage(threadId: string, text = "Please help", at = Date.now()) {
  const id = crypto.randomUUID();
  await acceptCustomerIngress(createDatabase(env.DB), {
    id,
    threadId,
    workspaceId: TEST_TOPOLOGY.workspaceId,
    inboxId: TEST_TOPOLOGY.inboxId,
    clientMessageId: id,
    workflowInstanceId: id,
    originalText: text,
    acceptedAt: new Date(at),
  });
}

function fakeWorkflow() {
  const createBatch = vi.fn().mockResolvedValue([{}]);
  return { createBatch, MESSAGE_WORKFLOW: { createBatch } as unknown as Env["MESSAGE_WORKFLOW"] };
}

function mockDiscord() {
  const posts: {
    content: string;
    components?: { components: { custom_id: string; label: string }[] }[];
    nonce: string;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.method === "GET") return Response.json([]);
      if (init?.method !== "POST" || typeof init.body !== "string")
        throw new Error("Unexpected Discord request");
      const body = JSON.parse(init.body);
      posts.push(body);
      return Response.json({
        id: String(100000000000000010n + BigInt(posts.length)),
        channel_id: TEST_TOPOLOGY.discordThreadId,
        ...body,
      });
    }),
  );
  return posts;
}

it("authenticates a hashed token without Origin and rejects absent, wrong, raw, reused and disabled credentials", async () => {
  expect((await request("/threads")).status).toBe(200);
  for (const authorization of [
    undefined,
    "Bearer wrong",
    "Basic nope",
    `Bearer ${await agentTokenHash(token)}`,
  ]) {
    const response = await app.request(
      "/v1/agent/threads",
      { headers: authorization ? { authorization } : {} },
      apiEnv,
    );
    expect(response.status).toBe(401);
  }
  expect(
    (
      await request("/threads", undefined, {
        AGENT_TOKEN_other: await agentTokenHash(token),
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await request("/threads", undefined, {
        [`AGENT_TOKEN_${TEST_TOPOLOGY.inboxId}`]: token,
      })
    ).status,
  ).toBe(401);
  const response = await app.request(
    "/v1/agent/threads",
    { headers: { authorization: `Bearer ${token}`, origin: "https://unlisted.example" } },
    apiEnv,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  await env.DB.prepare("UPDATE inbox SET status='disabled'").run();
  expect((await request("/threads")).status).toBe(401);
});

it("rate limits per token", async () => {
  await env.DB.prepare("INSERT INTO agent_rate_limit VALUES (?,?,120)")
    .bind(await agentTokenHash(token), Math.floor(Date.now() / 60000))
    .run();
  expect((await request("/threads")).status).toBe(429);
  await env.DB.prepare("UPDATE agent_rate_limit SET window=window-1").run();
  expect((await request("/threads")).status).toBe(200);
});

it("lists open and closed threads with activity timestamps and stable cursor pages", async () => {
  const first = await createCustomerFixture();
  const second = await createCustomerFixture();
  const closed = await createCustomerFixture();
  await seedReadyDiscordThread(first.threadId);
  const firstAt = Date.now() - 2_000;
  await customerMessage(first.threadId, "First question", firstAt);
  await customerMessage(second.threadId, "Second question", Date.now() - 1_000);
  await env.DB.prepare("UPDATE thread SET status='closed', closed_at=? WHERE id=?")
    .bind(Date.now(), closed.threadId)
    .run();

  const replyAt = new Date();
  const reply = {
    id: "human-reply",
    workspaceId: TEST_TOPOLOGY.workspaceId,
    inboxId: TEST_TOPOLOGY.inboxId,
    threadId: first.threadId,
    workflowInstanceId: "human-reply",
    acceptedAt: replyAt,
    originalEnglishText: "Answer",
    replyTranslation: "off",
  };
  await acceptOperatorIngress(createDatabase(env.DB), reply);
  await publishUntranslatedReply(createDatabase(env.DB), {
    ...reply,
    messageId: reply.id,
    generation: 1,
    transitionedAt: replyAt,
  });

  const openPage1 = await (
    await request("/threads?state=open&limit=1")
  ).json<{
    threads: Array<Record<string, unknown> & { id: string; visitor: { email: string } }>;
    nextCursor: string;
  }>();
  expect(openPage1.threads).toHaveLength(1);
  expect(openPage1.threads[0]?.id).toBe(first.threadId);
  expect(openPage1.threads[0]?.visitor.email).toContain("@example.test");
  expect(openPage1.threads[0]?.lastCustomerAt).toBe(new Date(firstAt).toISOString());
  expect(openPage1.threads[0]?.lastOperatorAt).toBe(replyAt.toISOString());
  expect(openPage1.threads[0]?.lastAgentAt).toBeNull();
  expect(openPage1.threads[0]?.discordThreadUrl).toContain(TEST_TOPOLOGY.discordThreadId);
  expect(openPage1.threads[0]).not.toHaveProperty("agentCursor");
  expect(openPage1.threads[0]).not.toHaveProperty("acknowledgedCursor");
  expect(openPage1.threads[0]).not.toHaveProperty("claimedBy");
  expect(openPage1.threads[0]).not.toHaveProperty("claimExpiresAt");

  const openPage2 = await (
    await request(`/threads?state=open&limit=1&cursor=${encodeURIComponent(openPage1.nextCursor)}`)
  ).json<{ threads: Array<{ id: string }>; nextCursor: string | null }>();
  expect(openPage2.threads.map((t) => t.id)).toEqual([second.threadId]);
  expect(openPage2.nextCursor).toBeNull();

  const closedList = await (
    await request("/threads?state=closed")
  ).json<{ threads: Array<{ id: string; state: string }> }>();
  expect(closedList.threads.map((t) => [t.id, t.state])).toEqual([[closed.threadId, "closed"]]);

  expect((await request("/threads?cursor=invalid")).status).toBe(400);
});

it("reads a thread transcript paged by row_id without notes", async () => {
  const first = await createCustomerFixture();
  await seedReadyDiscordThread(first.threadId);
  await customerMessage(first.threadId, "First question", Date.now() - 2_000);
  const reply = {
    id: "human-reply-read",
    workspaceId: TEST_TOPOLOGY.workspaceId,
    inboxId: TEST_TOPOLOGY.inboxId,
    threadId: first.threadId,
    workflowInstanceId: "human-reply-read",
    acceptedAt: new Date(),
    originalEnglishText: "Answer",
    replyTranslation: "off",
  };
  await acceptOperatorIngress(createDatabase(env.DB), reply);
  await publishUntranslatedReply(createDatabase(env.DB), {
    ...reply,
    messageId: reply.id,
    generation: 1,
    transitionedAt: new Date(),
  });

  const read = await (
    await request(`/threads/${first.threadId}?limit=1`)
  ).json<{
    messages: Array<{ rowId: number; originalText: string }>;
    through: string;
    nextCursor: string;
    discordThreadUrl: string;
    visitor: unknown;
  }>();
  expect(read.messages).toHaveLength(1);
  expect(read.messages[0]?.originalText).toBe("First question");
  expect(read.discordThreadUrl).toContain(TEST_TOPOLOGY.discordThreadId);
  expect(read.through).toBe(String(read.messages[0]!.rowId));
  expect(read.nextCursor).toBe(String(read.messages[0]!.rowId));
  expect(read).not.toHaveProperty("notes");

  const rest = await (
    await request(`/threads/${first.threadId}?cursor=${read.nextCursor}`)
  ).json<{
    messages: Array<{ rowId: number; customerVisibleText: string }>;
    through: string;
    nextCursor: string | null;
  }>();
  expect(rest.messages).toHaveLength(1);
  expect(rest.messages[0]?.customerVisibleText).toBe("Answer");
  expect(rest.through).toBe(String(rest.messages[0]!.rowId));
  expect(rest.nextCursor).toBeNull();

  const empty = await (
    await request(`/threads/${first.threadId}?cursor=${rest.through}`)
  ).json<{ messages: unknown[]; through: string; nextCursor: string | null }>();
  expect(empty.messages).toEqual([]);
  expect(empty.through).toBe(rest.through);
  expect(empty.nextCursor).toBeNull();
});

it("isolates reads, replies, and attachments from another inbox", async () => {
  const customer = await createCustomerFixture();
  await env.DB.prepare(
    "INSERT INTO inbox(id,workspace_id,product_id,name) VALUES ('other',?,?, 'Other')",
  )
    .bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.productId)
    .run();
  apiEnv = {
    ...apiEnv,
    [`AGENT_TOKEN_${TEST_TOPOLOGY.inboxId}`]: undefined,
    AGENT_TOKEN_other: await agentTokenHash(token),
  };
  expect((await (await request("/threads")).json<{ threads: unknown[] }>()).threads).toEqual([]);
  expect((await request(`/threads/${customer.threadId}`)).status).toBe(404);
  expect(
    (
      await request(`/threads/${customer.threadId}/replies`, {
        text: "No",
        idempotencyKey: "no",
      })
    ).status,
  ).toBe(404);
  expect(
    (await request(`/threads/${customer.threadId}/attachments/att_${"a".repeat(64)}`)).status,
  ).toBe(404);
});

it("returns 404 for removed agent routes", async () => {
  const { threadId } = await createCustomerFixture();
  for (const [suffix, body] of [
    ["notes", { kind: "reasoning", text: "Private", idempotencyKey: "n1" }],
    ["ack", { through: "0" }],
    ["claim", { leaseSeconds: 30 }],
    ["release", {}],
    ["close", {}],
    ["reopen", {}],
    ["replies/msg_agent_missing/approve", {}],
  ] as const) {
    expect((await request(`/threads/${threadId}/${suffix}`, body)).status).toBe(404);
  }
});

it("freezes reply identity before workflow creation and conflicts on changed text, thread or translation", async () => {
  const { threadId } = await createCustomerFixture();
  const other = await createCustomerFixture();
  const fake = fakeWorkflow();
  const body = { text: "Answer", idempotencyKey: "immutable" };
  const path = `/threads/${threadId}/replies`;
  expect((await request(path, body, fake)).status).toBe(202);
  // Extra unknown keys are ignored without changing idempotency.
  expect((await request(path, { ...body, mode: "send" }, fake)).status).toBe(202);
  expect(fake.createBatch.mock.calls[0]).toEqual(fake.createBatch.mock.calls[1]);
  for (const changed of [{ text: "Changed" }, { translate: "fr" }]) {
    expect((await request(path, { ...body, ...changed }, fake)).status).toBe(409);
  }
  expect((await request(`/threads/${other.threadId}/replies`, body, fake)).status).toBe(409);
  expect(await env.DB.prepare("SELECT count(*) n FROM agent_reply").first("n")).toBe(1);
  expect(await env.DB.prepare("SELECT count(*) n FROM message").first("n")).toBe(0);
});

it("rejects replies on a closed thread", async () => {
  const { threadId } = await createCustomerFixture();
  await env.DB.prepare("UPDATE thread SET status='closed', closed_at=? WHERE id=?")
    .bind(Date.now(), threadId)
    .run();
  const response = await request(
    `/threads/${threadId}/replies`,
    { text: "Too late", idempotencyKey: "closed-thread" },
    fakeWorkflow(),
  );
  expect(response.status).toBe(409);
});

it("sends through the real workflow once on repeated idempotencyKey, posts reply to Discord, and schedules reply email", async () => {
  const customer = await createCustomerFixture();
  await seedReadyDiscordThread(customer.threadId);
  await env.DB.prepare("UPDATE inbox SET email_config=?")
    .bind(
      JSON.stringify({
        from: "support@example.test",
        name: "Example",
        replyDomain: "example.test",
        unreadDelaySeconds: 600,
      }),
    )
    .run();
  const posts = mockDiscord();
  const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
  try {
    await workflows.modifyAll(async (modifier) => modifier.disableRetryDelays());
    const body = { text: "Your answer", idempotencyKey: "send-once" };
    const path = `/threads/${customer.threadId}/replies`;
    const response = await request(path, body);
    expect(response.status).toBe(202);
    const first = await response.json<{ messageId: string; status: string }>();
    expect(first).not.toHaveProperty("mode");
    expect(["accepted", "available"]).toContain(first.status);

    await (await workflows.get())[0]!.waitForStatus("complete");
    const replay = await request(path, body);
    expect(replay.status).toBe(202);
    const replayBody = await replay.json<{ messageId: string; status: string }>();
    expect(replayBody.messageId).toBe(first.messageId);
    expect(replayBody.status).toBe("available");
    expect(replayBody).not.toHaveProperty("mode");

    expect(posts).toHaveLength(1);
    expect(posts[0]?.content).toContain("**Agent Helper**");
    expect(posts[0]?.components).toBeUndefined();
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM message WHERE thread_id=? AND direction='operator_to_customer'",
      )
        .bind(customer.threadId)
        .first("n"),
    ).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT author_kind,author_name,customer_visible_text FROM message WHERE id=?",
      )
        .bind(first.messageId)
        .first(),
    ).toEqual({
      author_kind: "agent",
      author_name: "Helper",
      customer_visible_text: "Your answer",
    });
    expect(
      await env.DB.prepare("SELECT count(*) n FROM email_delivery WHERE message_id=?")
        .bind(first.messageId)
        .first("n"),
    ).toBe(1);
    const read = await app.request(
      `/v1/threads/${customer.threadId}/messages`,
      { headers: { origin: TEST_ORIGIN, authorization: `Bearer ${customer.sessionToken}` } },
      apiEnv,
    );
    expect(await read.text()).toContain("Your answer");
  } finally {
    await workflows.dispose();
  }
});

it("requires enabled translation and a known customer language, freezing the selected target", async () => {
  const { threadId } = await createCustomerFixture();
  const path = `/threads/${threadId}/replies`;
  const fake = fakeWorkflow();
  const body = { text: "Answer", idempotencyKey: "translate", translate: "fr" };
  expect((await request(path, body, { ...fake, TRANSLATION_ENABLED_INBOXES: "[]" })).status).toBe(
    409,
  );
  expect((await request(path, { ...body, translate: "customer" }, fake)).status).toBe(409);
  await env.DB.prepare("UPDATE thread SET customer_language='fr' WHERE id=?").bind(threadId).run();
  expect((await request(path, { ...body, translate: "customer" }, fake)).status).toBe(202);
  expect(fake.createBatch.mock.calls[0]?.[0][0].params.replyTranslation).toBe("fr");
  await env.DB.prepare("UPDATE thread SET customer_language='de' WHERE id=?").bind(threadId).run();
  await request(path, { ...body, translate: "customer" }, fake);
  expect(fake.createBatch.mock.calls[1]).toEqual(fake.createBatch.mock.calls[0]);
});

it("accepts a language name in the translate field and delivers translated agent replies without Discord buttons", async () => {
  const { threadId } = await createCustomerFixture();
  await seedReadyDiscordThread(threadId);
  const posts = mockDiscord();
  const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
  try {
    await workflows.modifyAll(async (modifier) => {
      await modifier.disableRetryDelays();
      await modifier.mockStepResult(
        { name: "translate-message" },
        {
          sourceLanguage: "en",
          targetLanguage: "my",
          translatedText: "ကျေးဇူးပြု၍ ပြန်ဖွင့်ပါ။",
          needsReview: true,
          mixedLanguage: false,
          ambiguityNotes: ["Check wording"],
          passThrough: false,
          promptVersion: "test",
          provider: "test",
          modelId: "test",
        },
      );
    });
    const response = await request(`/threads/${threadId}/replies`, {
      text: "Please reopen the app.",
      translate: "Burmese",
      idempotencyKey: "agent-translated-reply",
    });
    expect(response.status).toBe(202);
    const { messageId } = await response.json<{ messageId: string }>();
    await (await workflows.get())[0]!.waitForStatus("complete");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.components).toBeUndefined();
    expect(
      await env.DB.prepare("SELECT customer_visible_text FROM message WHERE id=?")
        .bind(messageId)
        .first("customer_visible_text"),
    ).toBe("ကျေးဇူးပြု၍ ပြန်ဖွင့်ပါ။");
    const read = await (
      await request(`/threads/${threadId}`)
    ).json<{ messages: Array<{ translations: Array<{ translatedText: string }> }> }>();
    expect(read.messages[0]?.translations[0]?.translatedText).toBe("ကျေးဇူးပြု၍ ပြန်ဖွင့်ပါ။");
  } finally {
    await workflows.dispose();
  }
});

it("returns only this visitor's configured PostHog activity and keeps provider errors explicit", async () => {
  const { threadId } = await createCustomerFixture();
  const visit = await env.DB.prepare(
    "SELECT v.posthog_distinct_id FROM visitor v JOIN thread t ON t.visitor_id=v.id WHERE t.id=?",
  )
    .bind(threadId)
    .first<{ posthog_distinct_id: string }>();
  const posthog = vi.fn<typeof fetch>(async (_url, init) => {
    if (typeof init?.body !== "string") throw new Error("Expected JSON request");
    expect(JSON.parse(init.body).variables.respondkit_distinct_id).toBe(visit!.posthog_distinct_id);
    return Response.json({
      columns: [
        "uuid",
        "timestamp",
        "event",
        "distinct_id",
        "page_path",
        "surface",
        "app_version",
        "error_code",
        "error_type",
        "input_type",
        "pipeline_mode",
      ],
      results: [
        [
          "event-1",
          new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
          "$pageview",
          visit!.posthog_distinct_id,
          "/export?private=value",
          null,
          null,
          null,
          null,
          null,
          null,
        ],
      ],
      endpoint_version: 1,
    });
  });
  vi.stubGlobal("fetch", posthog);
  const config = {
    POSTHOG_ACTIVITY_INBOXES: JSON.stringify({
      [TEST_TOPOLOGY.inboxId]: {
        host: "https://eu.posthog.com",
        projectId: 123,
        endpoint: "activity",
        version: 1,
      },
    }),
    [`POSTHOG_API_KEY_${TEST_TOPOLOGY.inboxId}`]: "test-only",
  };
  const read = await (
    await request(`/threads/${threadId}`, undefined, config)
  ).json<{ activity: { events: Array<{ path: string }> } }>();
  expect(read.activity.events[0]?.path).toBe("/export");
  expect(posthog).toHaveBeenCalledTimes(1);
  posthog.mockResolvedValue(Response.json({}, { status: 403 }));
  const failed = await (
    await request(`/threads/${threadId}`, undefined, config)
  ).json<{ activity: { error: string } }>();
  expect(failed.activity.error).toContain("HTTP 403");
});

it("reports ambiguous workflow acceptance without changing the persisted reply", async () => {
  const { threadId } = await createCustomerFixture();
  const fake = fakeWorkflow();
  fake.createBatch.mockRejectedValue(new Error("Workflow unavailable"));
  const body = { text: "Answer", idempotencyKey: "ambiguous" };
  const first = await request(`/threads/${threadId}/replies`, body, fake);
  expect(first.status).toBe(503);
  expect(await first.json()).toMatchObject({ acceptance: "acceptance_unknown" });
  fake.createBatch.mockResolvedValue([{}]);
  expect((await request(`/threads/${threadId}/replies`, body, fake)).status).toBe(202);
  expect(fake.createBatch.mock.calls[0]).toEqual(fake.createBatch.mock.calls[2]);
});

it("lists a message's attachments with the agent's download path, and serves them only to that inbox's agent in that thread", async () => {
  const { threadId } = await createCustomerFixture();
  const other = await createCustomerFixture();
  await customerMessage(threadId, "Here is a screenshot");
  const message = await env.DB.prepare(
    "SELECT m.id,t.visitor_id FROM message m JOIN thread t ON t.id=m.thread_id WHERE m.thread_id=? ORDER BY m.row_id DESC LIMIT 1",
  )
    .bind(threadId)
    .first<{ id: string; visitor_id: string }>();
  const attachmentId = `att_${"a".repeat(64)}`;
  const key = `${TEST_TOPOLOGY.workspaceId}/${TEST_TOPOLOGY.inboxId}/${attachmentId}`;
  const bucket = (env as unknown as { ATTACHMENTS: R2Bucket }).ATTACHMENTS;
  await bucket.put(key, "jpeg-bytes");
  await env.DB.prepare(`INSERT INTO attachment
    (id,workspace_id,inbox_id,visitor_id,object_key,download_token,download_url,name,content_type,size,upload_id,part_size,status,message_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,'',1,'ready',?)`)
    .bind(
      attachmentId,
      TEST_TOPOLOGY.workspaceId,
      TEST_TOPOLOGY.inboxId,
      message!.visitor_id,
      key,
      "b".repeat(64),
      `https://api.example/v1/files/${"b".repeat(64)}`,
      "touch.jpg",
      "image/jpeg",
      10,
      message!.id,
    )
    .run();
  const listed = {
    id: attachmentId,
    name: "touch.jpg",
    contentType: "image/jpeg",
    size: 10,
    downloadUrl: `https://api.example/v1/files/${"b".repeat(64)}`,
  };
  await env.DB.prepare("UPDATE message SET attachments=? WHERE id=?")
    .bind(JSON.stringify([listed]), message!.id)
    .run();
  const runtime = { ATTACHMENTS: bucket } as Partial<Env>;

  const read = await (
    await request(`/threads/${threadId}`, undefined, runtime)
  ).json<{
    messages: Array<{ id: string; attachments: unknown[] }>;
  }>();
  const path = `/v1/agent/threads/${threadId}/attachments/${attachmentId}`;
  expect(read.messages.find((m) => m.id === message!.id)!.attachments).toEqual([
    { ...listed, agentDownloadPath: path },
  ]);

  const download = await request(
    `/threads/${threadId}/attachments/${attachmentId}`,
    undefined,
    runtime,
  );
  expect(download.status).toBe(200);
  expect(download.headers.get("content-type")).toBe("application/octet-stream");
  expect(download.headers.get("x-attachment-content-type")).toBe("image/jpeg");
  expect(download.headers.get("content-disposition")).toContain("touch.jpg");
  expect(await download.text()).toBe("jpeg-bytes");

  expect(
    (await request(`/threads/${other.threadId}/attachments/${attachmentId}`, undefined, runtime))
      .status,
  ).toBe(404);
  expect(
    (await request(`/threads/${threadId}/attachments/att_${"c".repeat(64)}`, undefined, runtime))
      .status,
  ).toBe(404);
  expect(
    (
      await app.request(
        `/v1/agent/threads/${threadId}/attachments/${attachmentId}`,
        {},
        { ...apiEnv, ...runtime },
      )
    ).status,
  ).toBe(401);
});

it("rejects agent ingress when the agent_reply row is missing or the envelope was tampered with", async () => {
  const { threadId } = await createCustomerFixture();
  const threadRow = await env.DB.prepare("SELECT visitor_id FROM thread WHERE id=?")
    .bind(threadId)
    .first<{ visitor_id: string }>();
  const fake = fakeWorkflow();
  const res = await request(
    `/threads/${threadId}/replies`,
    { text: "Original text", idempotencyKey: "ingress-check" },
    fake,
  );
  expect(res.status).toBe(202);
  const { messageId } = await res.json<{ messageId: string }>();
  const stored = await env.DB.prepare("SELECT envelope FROM agent_reply WHERE message_id=?")
    .bind(messageId)
    .first<{ envelope: string }>();
  const envelope = JSON.parse(stored!.envelope);

  await expect(
    acceptAgentIngress(apiEnv, {
      ...envelope,
      messageId: `msg_agent_${"0".repeat(64)}`,
      visitorId: threadRow!.visitor_id,
    }),
  ).rejects.toThrow("Agent reply is missing or the immutable ingress differs");

  await expect(
    acceptAgentIngress(apiEnv, {
      ...envelope,
      originalText: "Tampered text",
    }),
  ).rejects.toThrow("Agent reply is missing or the immutable ingress differs");
});

it("handles concurrent POST /v1/agent/threads/:id/replies with the same idempotencyKey once", async () => {
  const { threadId } = await createCustomerFixture();
  await seedReadyDiscordThread(threadId);
  const posts = mockDiscord();
  const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
  try {
    await workflows.modifyAll(async (modifier) => modifier.disableRetryDelays());
    const payload = { text: "Concurrent reply", idempotencyKey: "concurrent-send" };
    const [first, second] = await Promise.all([
      request(`/threads/${threadId}/replies`, payload),
      request(`/threads/${threadId}/replies`, payload),
    ]);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    const firstBody = await first.json<{ messageId: string }>();
    const secondBody = await second.json<{ messageId: string }>();
    expect(firstBody.messageId).toBe(secondBody.messageId);

    const instances = await workflows.get();
    for (const instance of instances) await instance.waitForStatus("complete");
    expect(await env.DB.prepare("SELECT count(*) n FROM agent_reply").first("n")).toBe(1);
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM message WHERE thread_id=? AND direction='operator_to_customer'",
      )
        .bind(threadId)
        .first("n"),
    ).toBe(1);
    expect(posts).toHaveLength(1);
  } finally {
    await workflows.dispose();
  }
});
