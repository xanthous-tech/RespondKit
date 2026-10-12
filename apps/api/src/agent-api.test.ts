import {
  acceptCustomerIngress,
  acceptOperatorIngress,
  publishUntranslatedReply,
} from "@respondkit/conversations";
import { createExecutionContext, env, introspectWorkflow } from "cloudflare:test";
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
afterEach(() => vi.unstubAllGlobals());
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
    expect(posts[0]?.components?.[0]?.components.map((button) => button.label)).toEqual([
      "Approve",
      "Reject",
    ]);
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
    const response = await request(`/threads/${threadId}/replies`, {
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
