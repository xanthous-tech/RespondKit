import { deliverPendingNotes } from "./agent-notes";
import {
  ListMessagesResponseV1Schema,
  ListThreadsResponseV1Schema,
  ListThreadStatusesResponseV1Schema,
} from "@respondkit/protocol";
import { DiscordRestClient } from "@respondkit/discord";
import { enqueueReplyEmail, deliverPendingEmails } from "./email";
import { requestMessageTranslation } from "./translation-service";
import { syncDiscordReadReceipts } from "./read-receipts";
import {
  acceptCustomerIngress,
  acceptOperatorIngress,
  publishUntranslatedReply,
  loadEnglishTranslationContext,
  loadMessageTranslationContext,
} from "@respondkit/conversations";
import {
  createExecutionContext,
  env,
  introspectWorkflow,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, afterEach, expect, it, vi } from "vite-plus/test";
import {
  createCustomerFixture,
  createTestEnv,
  seedReadyDiscordThread,
  seedTopology,
  snowflakeAt,
  TEST_TOPOLOGY,
  TEST_ORIGIN,
} from "../test/fixtures";
import { agentTokenHash } from "./agent-api";
import { createDatabase } from "./db";
import { createHttpApp } from "./http";
import type { Env } from "./env";

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
function request(path: string, body?: unknown, run = "one", overrides: Partial<Env> = {}) {
  return app.request(
    `/v1/agent${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-agent-run-id": run,
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
async function submitLegacyDraft(threadId: string, body: unknown) {
  const { messageId } = await (
    await request(`/threads/${threadId}/replies`, body, "one", fakeWorkflow())
  ).json<{ messageId: string }>();
  const stored = await env.DB.prepare("SELECT envelope FROM agent_reply WHERE message_id=?")
    .bind(messageId)
    .first<{ envelope: string }>();
  const legacy = JSON.parse(stored!.envelope);
  delete legacy.agent.previewTranslation;
  await env.DB.prepare("UPDATE agent_reply SET envelope=? WHERE message_id=?")
    .bind(JSON.stringify(legacy), messageId)
    .run();
  return request(`/threads/${threadId}/replies`, body);
}
async function signedDecision(
  messageId: string,
  action = "approve",
  roles: string[] = [TEST_TOPOLOGY.operatorRoleId],
  extra: Record<string, unknown> = {},
) {
  const keys = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const hex = (buffer: ArrayBuffer) =>
    Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
  const publicKey = hex(await crypto.subtle.exportKey("raw", keys.publicKey));
  const body = JSON.stringify({
    id: snowflakeAt(),
    application_id: TEST_TOPOLOGY.applicationId,
    token: "fixture",
    type: 3,
    guild_id: TEST_TOPOLOGY.guildId,
    channel_id: TEST_TOPOLOGY.discordThreadId,
    channel: { type: 11, parent_id: TEST_TOPOLOGY.forumChannelId },
    member: { user: { id: TEST_TOPOLOGY.operatorId }, roles },
    data: { custom_id: `agent:${action}:${messageId}`, component_type: 2 },
    ...extra,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = hex(
    await crypto.subtle.sign(
      "Ed25519",
      keys.privateKey,
      new TextEncoder().encode(timestamp + body),
    ),
  );
  return app.request(
    "/v1/discord/interactions",
    {
      method: "POST",
      body,
      headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp },
    },
    { ...apiEnv, DISCORD_PUBLIC_KEY: publicKey },
    createExecutionContext(),
  );
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
      await request("/threads", undefined, "one", {
        AGENT_TOKEN_other: await agentTokenHash(token),
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await request("/threads", undefined, "one", {
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

it("rate limits by token across run identifiers", async () => {
  await env.DB.prepare("INSERT INTO agent_rate_limit VALUES (?,?,120)")
    .bind(await agentTokenHash(token), Math.floor(Date.now() / 60000))
    .run();
  expect((await request("/threads", undefined, "other")).status).toBe(429);
  await env.DB.prepare("UPDATE agent_rate_limit SET window=window-1").run();
  expect((await request("/threads")).status).toBe(200);
});

it("lists unanswered customer messages, context, state and stable cursor pages", async () => {
  const first = await createCustomerFixture();
  const second = await createCustomerFixture();
  await seedReadyDiscordThread(first.threadId);
  await customerMessage(first.threadId, "First question", Date.now() - 2000);
  await customerMessage(second.threadId);
  const response = await request("/threads?needsReply=1&state=open&limit=1");
  const page = await response.json<{
    threads: { id: string; visitor: { email: string } }[];
    nextCursor: string;
  }>();
  expect(page.threads).toHaveLength(1);
  expect(page.threads[0]?.visitor.email).toContain("@example.test");
  const next = await (
    await request(`/threads?needsReply=1&limit=1&cursor=${encodeURIComponent(page.nextCursor)}`)
  ).json<{ threads: { id: string }[] }>();
  expect(next.threads).toHaveLength(1);
  expect(next.threads[0]?.id).not.toBe(page.threads[0]?.id);
  const reply = {
    id: "human-reply",
    workspaceId: TEST_TOPOLOGY.workspaceId,
    inboxId: TEST_TOPOLOGY.inboxId,
    threadId: first.threadId,
    workflowInstanceId: "human-reply",
    acceptedAt: new Date(),
    originalEnglishText: "Answer",
    replyTranslation: "off",
  };
  await acceptOperatorIngress(createDatabase(env.DB), reply);
  expect(
    (await (await request("/threads?needsReply=1")).json<{ threads: unknown[] }>()).threads,
  ).toHaveLength(2);
  await publishUntranslatedReply(createDatabase(env.DB), {
    ...reply,
    messageId: reply.id,
    generation: 1,
    transitionedAt: new Date(),
  });
  expect(
    (await (await request("/threads?needsReply=1")).json<{ threads: unknown[] }>()).threads,
  ).toHaveLength(1);
  const read = await (
    await request(`/threads/${first.threadId}?limit=1`)
  ).json<{
    messages: { originalText: string }[];
    nextCursor: string;
    discordThreadUrl: string;
    visitor: unknown;
  }>();
  expect(read.messages[0]?.originalText).toBe("First question");
  expect(read.discordThreadUrl).toContain(TEST_TOPOLOGY.discordThreadId);
  expect(read.nextCursor).toBeTruthy();
  const rest = await (
    await request(`/threads/${first.threadId}?cursor=${read.nextCursor}`)
  ).json<{ messages: { customerVisibleText: string }[] }>();
  expect(rest.messages[0]?.customerVisibleText).toBe("Answer");
  expect((await request("/threads?cursor=invalid")).status).toBe(400);
});

it("isolates reads and every mutation from another inbox", async () => {
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
  for (const [suffix, body] of [
    ["notes", { kind: "note", text: "Private", idempotencyKey: "private" }],
    ["ack", { through: "0" }],
    ["claim", { leaseSeconds: 30 }],
    ["release", {}],
    ["close", {}],
    ["reopen", {}],
    ["replies", { text: "No", mode: "send", idempotencyKey: "no" }],
  ] as const) {
    expect((await request(`/threads/${customer.threadId}/${suffix}`, body)).status).toBe(404);
  }
});

it("claims atomically, renews, rejects other holders, expires, releases and closes/reopens", async () => {
  const { threadId } = await createCustomerFixture();
  const path = `/threads/${threadId}`;
  const claims = await Promise.all([
    request(`${path}/claim`, { leaseSeconds: 60 }, "one"),
    request(`${path}/claim`, { leaseSeconds: 60 }, "two"),
  ]);
  expect(claims.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
  const winner = claims[0]!.status === 200 ? "one" : "two";
  const loser = winner === "one" ? "two" : "one";
  expect((await request(`${path}/claim`, { leaseSeconds: 60 }, winner)).status).toBe(200);
  for (const action of ["release", "close", "reopen"])
    expect((await request(`${path}/${action}`, {}, loser)).status).toBe(409);
  expect(
    (
      await request(
        `${path}/replies`,
        { text: "No", mode: "send", idempotencyKey: "claimed" },
        loser,
      )
    ).status,
  ).toBe(409);
  await env.DB.prepare("UPDATE thread SET claim_expires_at=0 WHERE id=?").bind(threadId).run();
  expect((await request(`${path}/claim`, { leaseSeconds: 60 }, loser)).status).toBe(200);
  expect((await request(`${path}/release`, {}, loser)).status).toBe(200);
  expect((await request(`${path}/close`, {})).status).toBe(200);
  expect(
    await env.DB.prepare("SELECT status FROM thread WHERE id=?").bind(threadId).first("status"),
  ).toBe("closed");
  expect((await request(`${path}/claim`, { leaseSeconds: 60 })).status).toBe(409);
  expect((await request(`${path}/reopen`, {})).status).toBe(200);
});

it("freezes reply identity before workflow creation and conflicts on changed text, mode, thread or translation", async () => {
  const { threadId } = await createCustomerFixture();
  const other = await createCustomerFixture();
  const fake = fakeWorkflow();
  const body = { text: "Answer", mode: "send", idempotencyKey: "immutable" };
  const path = `/threads/${threadId}/replies`;
  expect((await request(path, body, "one", fake)).status).toBe(202);
  expect((await request(path, body, "one", fake)).status).toBe(202);
  expect(fake.createBatch.mock.calls[0]).toEqual(fake.createBatch.mock.calls[1]);
  for (const changed of [{ text: "Changed" }, { mode: "draft" }, { translate: "fr" }]) {
    expect((await request(path, { ...body, ...changed }, "one", fake)).status).toBe(409);
  }
  expect((await request(`/threads/${other.threadId}/replies`, body, "one", fake)).status).toBe(409);
  expect(await env.DB.prepare("SELECT count(*) n FROM agent_reply").first("n")).toBe(1);
  expect(await env.DB.prepare("SELECT count(*) n FROM message").first("n")).toBe(0);
});

it("sends through the real workflow once, attributes the Discord note and schedules the normal reply email", async () => {
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
    const body = { text: "Your answer", mode: "send", idempotencyKey: "send-once" };
    const path = `/threads/${customer.threadId}/replies`;
    const response = await request(path, body);
    expect(response.status).toBe(202);
    const { messageId } = await response.json<{ messageId: string }>();
    await (await workflows.get())[0]!.waitForStatus("complete");
    expect((await request(path, body)).status).toBe(202);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.content).toContain("**Agent Helper**");
    expect(
      await env.DB.prepare(
        "SELECT author_kind,author_name,customer_visible_text FROM message WHERE id=?",
      )
        .bind(messageId)
        .first(),
    ).toEqual({
      author_kind: "agent",
      author_name: "Helper",
      customer_visible_text: "Your answer",
    });
    expect(
      await env.DB.prepare("SELECT count(*) n FROM email_delivery WHERE message_id=?")
        .bind(messageId)
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

it("posts a private-to-operators draft then accepts only signed allowlisted approval, including duplicate taps", async () => {
  const { threadId } = await createCustomerFixture();
  await seedReadyDiscordThread(threadId);
  const posts = mockDiscord();
  const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
  try {
    await workflows.modifyAll(async (modifier) => modifier.disableRetryDelays());
    const response = await request(`/threads/${threadId}/replies`, {
      text: "Draft answer",
      mode: "draft",
      idempotencyKey: "draft-once",
    });
    expect(response.status).toBe(202);
    const { messageId } = await response.json<{ messageId: string }>();
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    // One plain message: no buttons, clearly not sent; operators use the Approve/Reject draft commands.
    expect(posts[0]?.components).toBeUndefined();
    expect(posts[0]?.content).toContain("· Draft, not sent**\nDraft answer");
    expect(posts[0]?.content).toContain("Apps → **Approve draft**");
    expect(await env.DB.prepare("SELECT count(*) n FROM message").first("n")).toBe(0);
    const unsigned = await app.request(
      "/v1/discord/interactions",
      { method: "POST", body: "{}" },
      apiEnv,
    );
    expect(unsigned.status).toBe(401);
    expect(await (await signedDecision(messageId, "approve", [])).text()).toContain(
      "not authorized",
    );
    expect(
      await (await signedDecision(messageId, "approve", undefined, { guild_id: "999999" })).text(),
    ).toContain("not authorized");
    expect(await (await signedDecision(messageId)).text()).toContain("approved");
    await (await workflows.get())[0]!.waitForStatus("complete");
    const get = vi.fn().mockRejectedValue(new Error("Workflow history expired"));
    apiEnv = { ...apiEnv, MESSAGE_WORKFLOW: { get } as unknown as Env["MESSAGE_WORKFLOW"] };
    expect(await (await signedDecision(messageId)).text()).toContain("approved");
    expect(get).not.toHaveBeenCalled();
    expect(posts).toHaveLength(2);
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM message WHERE id=? AND customer_availability='available'",
      )
        .bind(messageId)
        .first("n"),
    ).toBe(1);
  } finally {
    await workflows.dispose();
  }
});

it.each(["reject", "new-message", "close"])("does not publish a draft after %s", async (action) => {
  const { threadId } = await createCustomerFixture();
  await seedReadyDiscordThread(threadId);
  const posts = mockDiscord();
  const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
  try {
    const response = await request(`/threads/${threadId}/replies`, {
      text: "Draft",
      mode: "draft",
      idempotencyKey: action,
    });
    const { messageId } = await response.json<{ messageId: string }>();
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    if (action === "new-message") await customerMessage(threadId);
    if (action === "close") await request(`/threads/${threadId}/close`, {});
    const decision = await signedDecision(messageId, action === "reject" ? "reject" : "approve");
    expect(await decision.text()).toContain(action === "reject" ? "rejected" : "stale");
    if (action === "reject") {
      await (await workflows.get())[0]!.waitForStatus("complete");
      expect(await (await signedDecision(messageId)).text()).toContain("rejected");
    }
    expect(
      await env.DB.prepare("SELECT count(*) n FROM message WHERE id=?").bind(messageId).first("n"),
    ).toBe(0);
    expect(
      await env.DB.prepare("SELECT status FROM agent_reply WHERE message_id=?")
        .bind(messageId)
        .first("status"),
    ).toBe(action === "reject" ? "rejected" : "stale");
  } finally {
    await workflows.dispose();
  }
});

it("requires enabled translation and a known customer language, freezing the selected target", async () => {
  const { threadId } = await createCustomerFixture();
  const path = `/threads/${threadId}/replies`;
  const fake = fakeWorkflow();
  const body = { text: "Answer", mode: "send", idempotencyKey: "translate", translate: "fr" };
  expect(
    (await request(path, body, "one", { ...fake, TRANSLATION_ENABLED_INBOXES: "[]" })).status,
  ).toBe(409);
  expect((await request(path, { ...body, translate: "customer" }, "one", fake)).status).toBe(409);
  await env.DB.prepare("UPDATE thread SET customer_language='fr' WHERE id=?").bind(threadId).run();
  expect((await request(path, { ...body, translate: "customer" }, "one", fake)).status).toBe(202);
  expect(fake.createBatch.mock.calls[0]?.[0][0].params.replyTranslation).toBe("fr");
  await env.DB.prepare("UPDATE thread SET customer_language='de' WHERE id=?").bind(threadId).run();
  await request(path, { ...body, translate: "customer" }, "one", fake);
  expect(fake.createBatch.mock.calls[1]).toEqual(fake.createBatch.mock.calls[0]);
});

it("publishes optional translations and exposes a signed approval button for uncertain translations", async () => {
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
          targetLanguage: "fr",
          translatedText: "Votre réponse",
          needsReview: true,
          mixedLanguage: false,
          ambiguityNotes: ["Needs review"],
          passThrough: false,
          promptVersion: "test",
          provider: "test",
          modelId: "test",
        },
      );
    });
    const response = await request(`/threads/${threadId}/replies`, {
      text: "Your answer",
      translate: "fr",
      mode: "send",
      idempotencyKey: "translation-review",
    });
    expect(response.status).toBe(202);
    const { messageId } = await response.json<{ messageId: string }>();
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.components?.[0]?.components[0]?.label).toBe("Approve translation");
    expect(
      await env.DB.prepare("SELECT customer_availability FROM message WHERE id=?")
        .bind(messageId)
        .first("customer_availability"),
    ).toBe("pending");
    expect(await (await signedDecision(`${messageId}:1`, "translate", [])).text()).toContain(
      "not authorized",
    );
    expect(await (await signedDecision(`${messageId}:1`, "translate")).text()).toContain(
      "approved",
    );
    await (await workflows.get())[0]!.waitForStatus("complete");
    expect(
      await env.DB.prepare("SELECT customer_visible_text FROM message WHERE id=?")
        .bind(messageId)
        .first("customer_visible_text"),
    ).toBe("Votre réponse");
    const read = await (
      await request(`/threads/${threadId}`)
    ).json<{ messages: { translations: { translatedText: string }[] }[] }>();
    expect(read.messages[0]?.translations[0]?.translatedText).toBe("Votre réponse");
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
    await request(`/threads/${threadId}`, undefined, "one", config)
  ).json<{ activity: { events: { path: string }[] } }>();
  expect(read.activity.events[0]?.path).toBe("/export");
  expect(posthog).toHaveBeenCalledTimes(1);
  posthog.mockResolvedValue(Response.json({}, { status: 403 }));
  const failed = await (
    await request(`/threads/${threadId}`, undefined, "one", config)
  ).json<{ activity: { error: string } }>();
  expect(failed.activity.error).toContain("HTTP 403");
});

it("reports ambiguous workflow acceptance without changing the persisted reply", async () => {
  const { threadId } = await createCustomerFixture();
  const fake = fakeWorkflow();
  fake.createBatch.mockRejectedValue(new Error("Workflow unavailable"));
  const body = { text: "Answer", mode: "send", idempotencyKey: "ambiguous" };
  const first = await request(`/threads/${threadId}/replies`, body, "one", fake);
  expect(first.status).toBe(503);
  expect(await first.json()).toMatchObject({ acceptance: "acceptance_unknown" });
  fake.createBatch.mockResolvedValue([{}]);
  expect((await request(`/threads/${threadId}/replies`, body, "one", fake)).status).toBe(202);
  expect(fake.createBatch.mock.calls[0]).toEqual(fake.createBatch.mock.calls[2]);
});

it("revokes a draft's send authority when the customer writes during translation review", async () => {
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
          targetLanguage: "fr",
          translatedText: "Ancienne réponse",
          needsReview: true,
          mixedLanguage: false,
          ambiguityNotes: [],
          passThrough: false,
          promptVersion: "test",
          provider: "test",
          modelId: "test",
        },
      );
    });
    const response = await submitLegacyDraft(threadId, {
      text: "Old answer",
      translate: "fr",
      mode: "draft",
      idempotencyKey: "stale-review",
    });
    const { messageId } = await response.json<{ messageId: string }>();
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    await signedDecision(messageId);
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    await customerMessage(threadId, "Actually, the issue changed");
    expect(await (await signedDecision(`${messageId}:1`, "translate")).text()).toContain(
      "no longer awaiting",
    );
    await expect(
      publishUntranslatedReply(createDatabase(env.DB), {
        workspaceId: TEST_TOPOLOGY.workspaceId,
        inboxId: TEST_TOPOLOGY.inboxId,
        threadId,
        messageId,
        generation: 1,
        transitionedAt: new Date(),
      }),
    ).rejects.toThrow();
    expect(
      await env.DB.prepare("SELECT customer_availability FROM message WHERE id=?")
        .bind(messageId)
        .first("customer_availability"),
    ).toBe("pending");
    expect(
      await env.DB.prepare("SELECT status FROM agent_reply WHERE message_id=?")
        .bind(messageId)
        .first("status"),
    ).toBe("stale");
  } finally {
    await workflows.dispose();
  }
});

const privateText = "PRIVATE OF19 reasoning: never show this to the customer";
async function addNote(threadId: string, key = "note-once", text = privateText) {
  return request(`/threads/${threadId}/notes`, { kind: "reasoning", text, idempotencyKey: key });
}
async function steer(text: string, extra: Record<string, unknown> = {}, roles?: string[]) {
  return signedDecision("unused", "approve", roles, {
    type: 2,
    data: { type: 1, name: "agent", options: [{ type: 3, name: "message", value: text }] },
    ...extra,
  });
}
async function contextDecision(
  target: string,
  name = "Approve draft",
  extra: Record<string, unknown> = {},
  roles?: string[],
) {
  return signedDecision("unused", "approve", roles, {
    type: 2,
    data: { type: 3, name, target_id: target },
    ...extra,
  });
}
async function wakeList() {
  return (await request("/threads?needsAgent=1")).json<{
    threads: {
      id: string;
      lastCustomerAt: string | null;
      lastOperatorAt: string | null;
      lastAgentAt: string | null;
      agentCursor: string;
      acknowledgedCursor: string;
    }[];
  }>();
}

it("stores and chunks immutable notes, recovers missing mapping, and replays without reposting", async () => {
  const { threadId } = await createCustomerFixture();
  const text = "Private reasoning. ".repeat(300);
  const first = await addNote(threadId, "long-note", text);
  expect(first.status).toBe(503);
  const saved = await first.json<{ note: { id: string; sequence: string }; delivery: string }>();
  expect(saved.delivery).toBe("pending");
  await seedReadyDiscordThread(threadId);
  const posts = mockDiscord();
  const retry = await addNote(threadId, "long-note", text);
  expect(retry.status).toBe(200);
  expect(await retry.json()).toMatchObject({
    note: { id: saved.note.id, sequence: saved.note.sequence },
    delivery: "posted",
  });
  expect(posts.length).toBeGreaterThan(1);
  expect(posts[0]?.content).toContain("**Agent Helper** · reasoning");
  expect(posts.every((post) => post.content.length <= 2000)).toBe(true);
  const count = posts.length;
  expect((await addNote(threadId, "long-note", text)).status).toBe(200);
  expect(posts).toHaveLength(count);
  expect((await addNote(threadId, "long-note", "Changed")).status).toBe(409);
  const other = await createCustomerFixture();
  expect((await addNote(other.threadId, "long-note", text)).status).toBe(409);
  expect(
    (
      await request(`/threads/${threadId}/notes`, {
        kind: "summary",
        text,
        idempotencyKey: "long-note",
      })
    ).status,
  ).toBe(409);
  expect(await env.DB.prepare("SELECT count(*) n FROM internal_note").first("n")).toBe(1);
  expect(await env.DB.prepare("SELECT count(*) n FROM agent_timeline").first("n")).toBe(1);
  expect(await env.DB.prepare("SELECT count(*) n FROM message").first("n")).toBe(0);
});

it("keeps a failed note chunk pending and resumes only missing Discord chunks", async () => {
  const { threadId } = await createCustomerFixture();
  await seedReadyDiscordThread(threadId);
  const send = vi.spyOn(DiscordRestClient.prototype, "sendMessageReconciled");
  const posts = mockDiscord();
  send
    .mockImplementationOnce(async (input) => ({
      message: await new DiscordRestClient({ botToken: "test-only" }).sendMessage(input),
      reconciled: false,
    }))
    .mockRejectedValueOnce(new Error("fixture failure"));
  const text = "Reasoning ".repeat(450);
  expect((await addNote(threadId, "partial", text)).status).toBe(503);
  expect(posts).toHaveLength(1);
  send.mockRestore();
  expect((await addNote(threadId, "partial", text)).status).toBe(200);
  expect(posts).toHaveLength(3);
  expect(new Set(posts.map((post) => post.nonce)).size).toBe(3);
});

it("interleaves notes and messages across shared cursor pages even with equal timestamps", async () => {
  const { threadId } = await createCustomerFixture();
  const at = Date.now();
  await customerMessage(threadId, "First", at);
  await addNote(threadId);
  await customerMessage(threadId, "Last but older timestamp", at - 1000);
  const events: string[] = [];
  let cursor = "0";
  for (let page = 0; page < 3; page++) {
    const result = await (
      await request(`/threads/${threadId}?limit=1&cursor=${cursor}`)
    ).json<{
      messages: { sequence: string; originalText: string }[];
      notes: { sequence: string; text: string }[];
      through: string;
      nextCursor: string | null;
    }>();
    expect(result.messages.length + result.notes.length).toBe(1);
    events.push(...result.messages.map((m) => m.originalText), ...result.notes.map((n) => n.text));
    expect(Number(result.through)).toBeGreaterThan(Number(cursor));
    expect(result.nextCursor).toBe(page < 2 ? result.through : null);
    cursor = result.through;
  }
  expect(events).toEqual(["First", privateText, "Last but older timestamp"]);
  expect(await (await request(`/threads/${threadId}?cursor=${cursor}`)).json()).toMatchObject({
    messages: [],
    notes: [],
    nextCursor: null,
    through: cursor,
  });
});

it("wakes for customer messages, operator replies and steering, without agent self-wakes or lost concurrent events", async () => {
  const { threadId } = await createCustomerFixture();
  await seedReadyDiscordThread(threadId);
  mockDiscord();
  expect((await wakeList()).threads).toEqual([]);
  await customerMessage(threadId);
  const first = (await wakeList()).threads[0]!;
  expect(first).toMatchObject({
    id: threadId,
    lastOperatorAt: null,
    lastAgentAt: null,
    acknowledgedCursor: "0",
  });
  expect(first.lastCustomerAt).toBeTruthy();
  await customerMessage(threadId, "Arrives during processing", Date.now() - 10000);
  await request(`/threads/${threadId}/ack`, { through: first.agentCursor });
  expect((await wakeList()).threads).toHaveLength(1);
  const read = await (await request(`/threads/${threadId}`)).json<{ through: string }>();
  expect(
    await (await request(`/threads/${threadId}/ack`, { through: read.through })).json(),
  ).toEqual({ acknowledgedCursor: read.through });
  expect(await (await request(`/threads/${threadId}/ack`, { through: "0" })).json()).toEqual({
    acknowledgedCursor: read.through,
  });
  expect((await wakeList()).threads).toEqual([]);
  await addNote(threadId);
  await request(
    `/threads/${threadId}/replies`,
    { mode: "draft", text: "Draft", idempotencyKey: "self" },
    "one",
    fakeWorkflow(),
  );
  expect((await wakeList()).threads).toEqual([]);
  const reply = {
    id: "human-wake",
    workspaceId: TEST_TOPOLOGY.workspaceId,
    inboxId: TEST_TOPOLOGY.inboxId,
    threadId,
    workflowInstanceId: "human-wake",
    acceptedAt: new Date(),
    originalEnglishText: "Human reply",
    replyTranslation: "off",
  };
  await acceptOperatorIngress(createDatabase(env.DB), reply);
  const operator = (await wakeList()).threads[0]!;
  expect(operator.lastOperatorAt).toBeTruthy();
  expect(operator.lastAgentAt).toBeTruthy();
  await request(`/threads/${threadId}/ack`, { through: operator.agentCursor });
  expect((await wakeList()).threads).toEqual([]);
  expect(await (await steer("Check the logs")).text()).toContain("saved and posted");
  expect((await wakeList()).threads).toHaveLength(1);
  await request(`/threads/${threadId}/close`, {});
  expect((await wakeList()).threads).toEqual([]);
  await request(`/threads/${threadId}/reopen`, {});
  expect((await wakeList()).threads).toHaveLength(1);
});

it("validates acknowledgement ownership, format and live leases; replayed notes survive another holder's claim", async () => {
  const { threadId } = await createCustomerFixture();
  const other = await createCustomerFixture();
  await customerMessage(other.threadId);
  const through = (await (await request(`/threads/${other.threadId}`)).json<{ through: string }>())
    .through;
  for (const value of [through, "999999", "-1", "1.5", "9007199254740993", 1, null])
    expect((await request(`/threads/${threadId}/ack`, { through: value })).status).toBe(400);
  expect((await request(`/threads/${threadId}/ack`, { through: "0" })).status).toBe(200);
  await seedReadyDiscordThread(threadId);
  mockDiscord();
  expect((await addNote(threadId)).status).toBe(201);
  await request(`/threads/${threadId}/claim`, { leaseSeconds: 300 }, "two");
  expect((await addNote(threadId, "different")).status).toBe(409);
  expect((await addNote(threadId)).status).toBe(200);
  expect((await request(`/threads/${threadId}/ack`, { through: "0" })).status).toBe(409);
});

it.each(["thread list", "thread detail", "thread statuses", "widget and native transcript"])(
  "isolates internal notes from customer %s payloads",
  async (surface) => {
    const customer = await createCustomerFixture();
    const path =
      surface === "thread list"
        ? "/v1/threads"
        : surface === "thread detail"
          ? `/v1/threads/${customer.threadId}`
          : surface === "thread statuses"
            ? "/v1/thread-statuses"
            : `/v1/threads/${customer.threadId}/messages`;
    const read = () =>
      app.request(
        path,
        { headers: { origin: TEST_ORIGIN, authorization: `Bearer ${customer.sessionToken}` } },
        apiEnv,
      );
    const before = await (await read()).json();
    await addNote(customer.threadId);
    const response = await read();
    expect(response.status).toBe(200);
    const after = await response.json();
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain(privateText);
    if (surface === "thread list") ListThreadsResponseV1Schema.parse(after);
    if (surface === "thread statuses") ListThreadStatusesResponseV1Schema.parse(after);
    if (surface === "widget and native transcript") ListMessagesResponseV1Schema.parse(after);
  },
);

it("excludes notes from emails, read receipts, translation context/jobs and needsReply", async () => {
  const customer = await createCustomerFixture();
  await seedReadyDiscordThread(customer.threadId);
  mockDiscord();
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
  await customerMessage(customer.threadId);
  const note = (
    await (await addNote(customer.threadId)).json<{ note: { id: string; sequence: string } }>()
  ).note;
  const scope = {
    workspaceId: TEST_TOPOLOGY.workspaceId,
    inboxId: TEST_TOPOLOGY.inboxId,
    threadId: customer.threadId,
  };
  const db = createDatabase(env.DB);
  expect(
    await loadEnglishTranslationContext(db, { ...scope, before: new Date(Date.now() + 1000) }),
  ).toEqual([]);
  expect(
    JSON.stringify(
      await loadMessageTranslationContext(db, { ...scope, before: new Date(Date.now() + 1000) }),
    ),
  ).not.toContain(privateText);
  await expect(requestMessageTranslation(apiEnv, scope, note.id, "en")).rejects.toThrow(
    "Select a customer message",
  );
  expect(await env.DB.prepare("SELECT count(*) n FROM translation_job").first("n")).toBe(0);
  await enqueueReplyEmail(apiEnv, note.id);
  const send = vi.fn().mockResolvedValue({ messageId: "test-email" });
  await deliverPendingEmails({
    ...apiEnv,
    EMAIL: { send } as unknown as NonNullable<Env["EMAIL"]>,
  });
  expect(send).not.toHaveBeenCalled();
  expect(await env.DB.prepare("SELECT count(*) n FROM email_delivery").first("n")).toBe(0);
  const reactions = vi.spyOn(DiscordRestClient.prototype, "addReadReaction").mockResolvedValue();
  await syncDiscordReadReceipts(apiEnv);
  expect(reactions).not.toHaveBeenCalled();
  const ctx = createExecutionContext();
  const receipt = await app.request(
    `/v1/threads/${customer.threadId}/read`,
    {
      method: "POST",
      headers: {
        origin: TEST_ORIGIN,
        authorization: `Bearer ${customer.sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ cursor: note.sequence }),
    },
    apiEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(receipt.status).toBe(400);
  expect(
    (await (await request("/threads?needsReply=1")).json<{ threads: unknown[] }>()).threads,
  ).toHaveLength(1);
  expect(
    await env.DB.prepare("SELECT customer_read_cursor FROM thread WHERE id=?")
      .bind(customer.threadId)
      .first("customer_read_cursor"),
  ).toBe(0);
});

it("accepts only signed allowlisted steering with durable operator identity and idempotent echoes", async () => {
  const { threadId } = await createCustomerFixture();
  await seedReadyDiscordThread(threadId);
  const posts = mockDiscord();
  expect(await (await steer("Private", {}, [])).text()).toContain("not authorized");
  for (const extra of [
    { guild_id: "9999" },
    { channel_id: "9999" },
    { channel: { type: 0, parent_id: TEST_TOPOLOGY.forumChannelId } },
  ])
    expect(await (await steer("Private", extra)).text()).toContain("not authorized");
  const interactionId = snowflakeAt();
  expect(await (await steer("Please investigate", { id: interactionId })).text()).toContain(
    "saved and posted",
  );
  expect(await (await steer("Please investigate", { id: interactionId })).text()).toContain(
    "saved and posted",
  );
  expect(await (await steer("Changed", { id: interactionId })).text()).toContain("different note");
  expect(posts).toHaveLength(1);
  expect(posts[0]?.content).toContain("· steer");
  const read = await (await request(`/threads/${threadId}`)).json<{ notes: unknown[] }>();
  expect(read.notes).toEqual([
    expect.objectContaining({
      authorKind: "operator",
      authorName: TEST_TOPOLOGY.operatorId,
      operatorDiscordUserId: TEST_TOPOLOGY.operatorId,
      kind: "steer",
      text: "Please investigate",
    }),
  ]);
});

it.each(["Approve draft", "Reject draft"])(
  "routes %s from any draft chunk through the signed first-decision-wins path",
  async (name) => {
    const { threadId } = await createCustomerFixture();
    await seedReadyDiscordThread(threadId);
    const posts = mockDiscord();
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => modifier.disableRetryDelays());
      const response = await request(`/threads/${threadId}/replies`, {
        text: "A long English answer. ".repeat(200),
        mode: "draft",
        idempotencyKey: name,
      });
      const { messageId } = await response.json<{ messageId: string }>();
      await vi.waitFor(async () =>
        expect(
          await env.DB.prepare("SELECT count(*) n FROM agent_draft_chunk WHERE message_id=?")
            .bind(messageId)
            .first("n"),
        ).toBe(3),
      );
      expect(posts).toHaveLength(3);
      const chunks = (
        await env.DB.prepare(
          "SELECT discord_message_id FROM agent_draft_chunk WHERE message_id=? ORDER BY chunk_index",
        )
          .bind(messageId)
          .all<{ discord_message_id: string }>()
      ).results;
      expect(
        await (await contextDecision(chunks[0]!.discord_message_id, name, {}, [])).text(),
      ).toContain("not authorized");
      expect(
        await (
          await contextDecision(chunks[0]!.discord_message_id, name, { channel_id: "999" })
        ).text(),
      ).toContain("not authorized");
      expect(await (await contextDecision("999999", name)).text()).toContain("not found");
      expect(await (await contextDecision(chunks[0]!.discord_message_id, name)).text()).toContain(
        name === "Approve draft" ? "approved" : "rejected",
      );
      await (await workflows.get())[0]!.waitForStatus("complete");
      for (const chunk of chunks)
        expect(
          await (
            await contextDecision(
              chunk.discord_message_id,
              name === "Approve draft" ? "Reject draft" : "Approve draft",
            )
          ).text(),
        ).toContain(name === "Approve draft" ? "approved" : "rejected");
      expect(
        await env.DB.prepare(
          "SELECT count(*) n FROM message WHERE id=? AND customer_availability='available'",
        )
          .bind(messageId)
          .first("n"),
      ).toBe(name === "Approve draft" ? 1 : 0);
    } finally {
      await workflows.dispose();
    }
  },
);

it("invalidates a draft after steering while agent reasoning does not invalidate it", async () => {
  const { threadId } = await createCustomerFixture();
  await seedReadyDiscordThread(threadId);
  mockDiscord();
  const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
  try {
    const { messageId } = await (
      await request(`/threads/${threadId}/replies`, {
        text: "Draft",
        mode: "draft",
        idempotencyKey: "steered",
      })
    ).json<{ messageId: string }>();
    let chunk: { discord_message_id: string } | null = null;
    await vi.waitFor(async () => {
      chunk = await env.DB.prepare(
        "SELECT discord_message_id FROM agent_draft_chunk WHERE message_id=?",
      )
        .bind(messageId)
        .first();
      expect(chunk).toBeTruthy();
    });
    await addNote(threadId);
    expect(
      await env.DB.prepare("SELECT status FROM agent_reply WHERE message_id=?")
        .bind(messageId)
        .first("status"),
    ).toBe("pending");
    await steer("Do not send that; investigate first");
    expect(await (await contextDecision(chunk!.discord_message_id)).text()).toContain("stale");
    expect(await (await signedDecision(messageId)).text()).toContain("stale");
    expect(await env.DB.prepare("SELECT count(*) n FROM message").first("n")).toBe(0);
  } finally {
    await workflows.dispose();
  }
});

it.each([false, true])(
  "shows English and translation before one approval (needsReview=%s)",
  async (needsReview) => {
    const { threadId } = await createCustomerFixture();
    await seedReadyDiscordThread(threadId);
    await env.DB.prepare("UPDATE thread SET customer_language='fr' WHERE id=?")
      .bind(threadId)
      .run();
    const posts = mockDiscord();
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepError(
          { name: "translate-message", index: 2 },
          new Error("Translation must not run twice"),
        );
        await modifier.mockStepResult(
          { name: "translate-message" },
          {
            sourceLanguage: "en",
            targetLanguage: "fr",
            translatedText: "Votre réponse",
            needsReview,
            mixedLanguage: false,
            ambiguityNotes: needsReview ? ["Check export wording"] : [],
            passThrough: false,
            promptVersion: "test",
            provider: "test",
            modelId: "test",
          },
        );
      });
      const { messageId } = await (
        await request(`/threads/${threadId}/replies`, {
          text: "Your English answer",
          translate: "customer",
          mode: "draft",
          idempotencyKey: "one-tap",
        })
      ).json<{ messageId: string }>();
      await vi.waitFor(async () =>
        expect(
          await env.DB.prepare(
            "SELECT count(*) n FROM agent_draft_preview WHERE message_id=? AND posted_at IS NOT NULL",
          )
            .bind(messageId)
            .first("n"),
        ).toBe(1),
      );
      expect(posts[0]?.content).toContain("Your English answer");
      expect(posts[0]?.content).toContain("Votre réponse");
      if (needsReview) expect(posts[0]?.content).toContain("Check export wording");
      expect(
        await env.DB.prepare("SELECT confirmed_by FROM agent_draft_preview WHERE message_id=?")
          .bind(messageId)
          .first("confirmed_by"),
      ).toBeNull();
      expect(await env.DB.prepare("SELECT count(*) n FROM message").first("n")).toBe(0);
      expect(await env.DB.prepare("SELECT count(*) n FROM reply_review").first("n")).toBe(0);
      expect(await (await signedDecision(messageId, "approve", [])).text()).toContain(
        "not authorized",
      );
      expect(
        await env.DB.prepare("SELECT confirmed_by FROM agent_draft_preview WHERE message_id=?")
          .bind(messageId)
          .first("confirmed_by"),
      ).toBeNull();
      const chunk = await env.DB.prepare(
        "SELECT discord_message_id FROM agent_draft_chunk WHERE message_id=?",
      )
        .bind(messageId)
        .first<{ discord_message_id: string }>();
      await contextDecision(chunk!.discord_message_id);
      await (await workflows.get())[0]!.waitForStatus("complete");
      expect(posts).toHaveLength(2);
      expect(
        posts.flatMap(
          (post) =>
            post.components?.flatMap((row) => row.components.map((button) => button.label)) ?? [],
        ),
      ).not.toContain("Approve translation");
      const review = await env.DB.prepare(
        "SELECT result_json,confirmed_by FROM reply_review WHERE message_id=?",
      )
        .bind(messageId)
        .first<{ result_json: string; confirmed_by: string }>();
      const preview = await env.DB.prepare(
        "SELECT result_json,confirmed_by FROM agent_draft_preview WHERE message_id=?",
      )
        .bind(messageId)
        .first();
      expect(review).toEqual(preview);
      expect(review?.confirmed_by).toBe(TEST_TOPOLOGY.operatorId);
      expect(JSON.parse(review!.result_json)).toMatchObject({
        translatedText: "Votre réponse",
        needsReview,
      });
      expect(
        await (await contextDecision(chunk!.discord_message_id, "Reject draft")).text(),
      ).toContain("approved");
      expect(await (await signedDecision(messageId)).text()).toContain("already available");
      expect(
        await env.DB.prepare("SELECT original_text,customer_visible_text FROM message WHERE id=?")
          .bind(messageId)
          .first(),
      ).toEqual({ original_text: "Your English answer", customer_visible_text: "Votre réponse" });
    } finally {
      await workflows.dispose();
    }
  },
);

it("retries stored note echoes on the scheduled path once the Discord mapping is ready", async () => {
  const { threadId } = await createCustomerFixture();
  expect((await addNote(threadId)).status).toBe(503);
  const posts = mockDiscord();
  await deliverPendingNotes(apiEnv);
  expect(posts).toHaveLength(0);
  await seedReadyDiscordThread(threadId);
  await Promise.all([deliverPendingNotes(apiEnv), deliverPendingNotes(apiEnv)]);
  expect(posts).toHaveLength(1);
  await deliverPendingNotes(apiEnv);
  expect(posts).toHaveLength(1);
  expect(
    await env.DB.prepare(
      "SELECT count(*) n FROM internal_note WHERE discord_posted_at IS NOT NULL",
    ).first("n"),
  ).toBe(1);
});

it("reads full 100-message timeline pages within D1's production binding limit", async () => {
  const { threadId } = await createCustomerFixture();
  await env.DB.batch(
    Array.from({ length: 101 }, (_, index) =>
      env.DB.prepare(
        "INSERT INTO message(id,workspace_id,inbox_id,thread_id,workflow_instance_id,direction,original_text,customer_visible_text,client_message_id,accepted_at) VALUES (?,?,?,?,?,'customer_to_operator','Question','Question',?,?)",
      ).bind(
        `bulk-${index}`,
        TEST_TOPOLOGY.workspaceId,
        TEST_TOPOLOGY.inboxId,
        threadId,
        `bulk-${index}`,
        `bulk-${index}`,
        Date.now(),
      ),
    ),
  );
  const prepare = env.DB.prepare.bind(env.DB);
  const limitedDb = {
    prepare(query: string) {
      const statement = prepare(query);
      const bind = statement.bind.bind(statement);
      statement.bind = (...values: unknown[]) => {
        expect(values.length).toBeLessThanOrEqual(100);
        return bind(...values);
      };
      return statement;
    },
  } as D1Database;
  const response = await request(`/threads/${threadId}?limit=100`, undefined, "one", {
    DB: limitedDb,
  });
  expect(response.status).toBe(200);
  const page = await response.json<{ messages: unknown[]; nextCursor: string }>();
  expect(page.messages).toHaveLength(100);
  expect(page.nextCursor).toBeTruthy();
  const next = await request(
    `/threads/${threadId}?limit=100&cursor=${page.nextCursor}`,
    undefined,
    "one",
    { DB: limitedDb },
  );
  expect(await next.json()).toMatchObject({
    messages: [expect.objectContaining({ id: "bulk-100" })],
    nextCursor: null,
  });
});

it("preserves an approved legacy draft through steering during uncertain translation review", async () => {
  const { threadId } = await createCustomerFixture();
  await seedReadyDiscordThread(threadId);
  const posts = mockDiscord();
  const body = {
    text: "Approved answer",
    translate: "fr",
    mode: "draft",
    idempotencyKey: "approved-steer",
  };
  const frozen = fakeWorkflow();
  const { messageId } = await (
    await request(`/threads/${threadId}/replies`, body, "one", frozen)
  ).json<{ messageId: string }>();
  const stored = await env.DB.prepare("SELECT envelope FROM agent_reply WHERE message_id=?")
    .bind(messageId)
    .first<{ envelope: string }>();
  const legacy = JSON.parse(stored!.envelope);
  delete legacy.agent.previewTranslation;
  await env.DB.prepare("UPDATE agent_reply SET envelope=? WHERE message_id=?")
    .bind(JSON.stringify(legacy), messageId)
    .run();
  const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
  try {
    await workflows.modifyAll(async (modifier) => {
      await modifier.disableRetryDelays();
      await modifier.mockStepResult(
        { name: "translate-message" },
        {
          sourceLanguage: "en",
          targetLanguage: "fr",
          translatedText: "Réponse approuvée",
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
    await request(`/threads/${threadId}/replies`, body);
    await vi.waitFor(() => expect(posts).toHaveLength(1));
    await signedDecision(messageId);
    await vi.waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]?.components?.[0]?.components[0]?.label).toBe("Approve translation");
    await steer("Investigate the next question");
    expect(
      await env.DB.prepare("SELECT status FROM agent_reply WHERE message_id=?")
        .bind(messageId)
        .first("status"),
    ).toBe("approved");
    expect(await (await signedDecision(`${messageId}:1`, "translate")).text()).toContain(
      "approved",
    );
    await (await workflows.get())[0]!.waitForStatus("complete");
    expect(
      await env.DB.prepare("SELECT customer_visible_text FROM message WHERE id=?")
        .bind(messageId)
        .first("customer_visible_text"),
    ).toBe("Réponse approuvée");
  } finally {
    await workflows.dispose();
  }
});

it("refuses approval until the full translated preview is posted, and permits rejection without confirming it", async () => {
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
          targetLanguage: "fr",
          translatedText: "Réponse ".repeat(400),
          needsReview: true,
          mixedLanguage: false,
          ambiguityNotes: ["Check wording"],
          passThrough: false,
          promptVersion: "test",
          provider: "test",
          modelId: "test",
        },
      );
      await modifier.mockStepResult({ name: "mark-draft-preview-posted" }, {});
    });
    const { messageId } = await (
      await request(`/threads/${threadId}/replies`, {
        text: "English answer",
        translate: "fr",
        mode: "draft",
        idempotencyKey: "incomplete-preview",
      })
    ).json<{ messageId: string }>();
    await vi.waitFor(async () =>
      expect(
        await env.DB.prepare("SELECT count(*) n FROM agent_draft_chunk WHERE message_id=?")
          .bind(messageId)
          .first("n"),
      ).toBe(2),
    );
    expect(posts).toHaveLength(2);
    const chunk = await env.DB.prepare(
      "SELECT discord_message_id FROM agent_draft_chunk WHERE message_id=? AND chunk_index=0",
    )
      .bind(messageId)
      .first<{ discord_message_id: string }>();
    expect(await (await contextDecision(chunk!.discord_message_id)).text()).toContain(
      "not fully posted",
    );
    expect(await (await signedDecision(messageId)).text()).toContain("not fully posted");
    expect(
      await env.DB.prepare("SELECT status FROM agent_reply WHERE message_id=?")
        .bind(messageId)
        .first("status"),
    ).toBe("pending");
    expect(
      await env.DB.prepare("SELECT confirmed_by FROM agent_draft_preview WHERE message_id=?")
        .bind(messageId)
        .first("confirmed_by"),
    ).toBeNull();
    expect(
      await (await contextDecision(chunk!.discord_message_id, "Reject draft")).text(),
    ).toContain("rejected");
    await (await workflows.get())[0]!.waitForStatus("complete");
    expect(await (await signedDecision(messageId)).text()).toContain("rejected");
    expect(await env.DB.prepare("SELECT count(*) n FROM message").first("n")).toBe(0);
    expect(await env.DB.prepare("SELECT count(*) n FROM reply_review").first("n")).toBe(0);
  } finally {
    await workflows.dispose();
  }
});

it.each(["customer", "steer", "close"])(
  "refuses a translated preview after %s changes the pending draft",
  async (change) => {
    const { threadId } = await createCustomerFixture();
    await seedReadyDiscordThread(threadId);
    mockDiscord();
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult(
          { name: "translate-message" },
          {
            sourceLanguage: "en",
            targetLanguage: "fr",
            translatedText: "Réponse",
            needsReview: true,
            mixedLanguage: false,
            ambiguityNotes: [],
            passThrough: false,
            promptVersion: "test",
            provider: "test",
            modelId: "test",
          },
        );
      });
      const { messageId } = await (
        await request(`/threads/${threadId}/replies`, {
          text: "English answer",
          translate: "fr",
          mode: "draft",
          idempotencyKey: change,
        })
      ).json<{ messageId: string }>();
      await vi.waitFor(async () =>
        expect(
          await env.DB.prepare("SELECT posted_at FROM agent_draft_preview WHERE message_id=?")
            .bind(messageId)
            .first("posted_at"),
        ).toBeTypeOf("number"),
      );
      if (change === "customer") await customerMessage(threadId);
      if (change === "steer") await steer("Change that answer");
      if (change === "close") await request(`/threads/${threadId}/close`, {});
      expect(await (await signedDecision(messageId)).text()).toContain("stale");
      expect(
        await env.DB.prepare("SELECT confirmed_by FROM agent_draft_preview WHERE message_id=?")
          .bind(messageId)
          .first("confirmed_by"),
      ).toBeNull();
      expect(
        await env.DB.prepare("SELECT count(*) n FROM message WHERE id=?")
          .bind(messageId)
          .first("n"),
      ).toBe(0);
    } finally {
      await workflows.dispose();
    }
  },
);

it("does not auto-confirm a translation from approved draft status alone", async () => {
  const { threadId } = await createCustomerFixture();
  await seedReadyDiscordThread(threadId);
  mockDiscord();
  const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
  try {
    await workflows.modifyAll(async (modifier) => {
      await modifier.disableRetryDelays();
      await modifier.mockStepResult(
        { name: "translate-message" },
        {
          sourceLanguage: "en",
          targetLanguage: "fr",
          translatedText: "Réponse",
          needsReview: true,
          mixedLanguage: false,
          ambiguityNotes: [],
          passThrough: false,
          promptVersion: "test",
          provider: "test",
          modelId: "test",
        },
      );
    });
    const { messageId } = await (
      await request(`/threads/${threadId}/replies`, {
        text: "English answer",
        translate: "fr",
        mode: "draft",
        idempotencyKey: "no-auto-confirm",
      })
    ).json<{ messageId: string }>();
    await vi.waitFor(async () =>
      expect(
        await env.DB.prepare("SELECT posted_at FROM agent_draft_preview WHERE message_id=?")
          .bind(messageId)
          .first("posted_at"),
      ).toBeTypeOf("number"),
    );
    await env.DB.prepare("UPDATE agent_reply SET status='approved',decided_by=? WHERE message_id=?")
      .bind(TEST_TOPOLOGY.operatorId, messageId)
      .run();
    const row = await env.DB.prepare("SELECT envelope FROM agent_reply WHERE message_id=?")
      .bind(messageId)
      .first<{ envelope: string }>();
    const instance = await env.MESSAGE_WORKFLOW.get(JSON.parse(row!.envelope).workflowInstanceId);
    await instance.sendEvent({ type: "agent-decision", payload: {} });
    await (await workflows.get())[0]!.waitForStatus("errored");
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM reply_review WHERE message_id=? AND confirmed_by IS NOT NULL",
      )
        .bind(messageId)
        .first("n"),
    ).toBe(0);
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM message WHERE id=? AND customer_availability='available'",
      )
        .bind(messageId)
        .first("n"),
    ).toBe(0);
  } finally {
    await workflows.dispose();
  }
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
    await request(`/threads/${threadId}`, undefined, "one", runtime)
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
    "one",
    runtime,
  );
  expect(download.status).toBe(200);
  expect(download.headers.get("content-type")).toBe("application/octet-stream");
  expect(download.headers.get("x-attachment-content-type")).toBe("image/jpeg");
  expect(download.headers.get("content-disposition")).toContain("touch.jpg");
  expect(await download.text()).toBe("jpeg-bytes");
  // Not from another thread's path, not for an unknown id, not without the token.
  expect(
    (
      await request(
        `/threads/${other.threadId}/attachments/${attachmentId}`,
        undefined,
        "one",
        runtime,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await request(
        `/threads/${threadId}/attachments/att_${"c".repeat(64)}`,
        undefined,
        "one",
        runtime,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await app.request(
        `/v1/agent${`/threads/${threadId}/attachments/${attachmentId}`}`,
        {},
        { ...apiEnv, ...runtime },
      )
    ).status,
  ).toBe(401);
});
