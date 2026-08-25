import { describe, expect, it } from "vite-plus/test";

import {
  DiscordRestClient,
  DiscordRestError,
  classifyDiscordHttpStatus,
  createDiscordCorrelationMarker,
  createDiscordNonce,
  splitDiscordMessage,
} from "./rest";

const ids = {
  guild: "100000000000000001",
  forum: "100000000000000002",
  thread: "100000000000000003",
  message: "100000000000000004",
};

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("Discord message helpers", () => {
  it("splits deterministically without losing text or splitting surrogate pairs", () => {
    const content = `${"a".repeat(1_999)}😀${"b".repeat(2_000)}`;
    const chunks = splitDiscordMessage(content);
    expect(chunks.join("")).toBe(content);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.length <= 2_000)).toBe(true);
    expect(chunks[0]).toHaveLength(1_999);
  });

  it("builds stable per-chunk nonces and correlation markers", () => {
    const first = createDiscordNonce("message-123", 0);
    expect(first).toBe(createDiscordNonce("message-123", 0));
    expect(first).not.toBe(createDiscordNonce("message-123", 1));
    expect(first.length).toBeLessThanOrEqual(25);
    expect(createDiscordCorrelationMarker("thread-123")).toMatch(/^ac:[0-9a-f]{16}$/);
  });

  it("classifies only transient statuses for Workflow retries", () => {
    expect(classifyDiscordHttpStatus(408)).toBe("retryable");
    expect(classifyDiscordHttpStatus(429)).toBe("retryable");
    expect(classifyDiscordHttpStatus(503)).toBe("retryable");
    expect(classifyDiscordHttpStatus(400)).toBe("permanent");
    expect(classifyDiscordHttpStatus(403)).toBe("permanent");
  });
});

describe("DiscordRestClient", () => {
  it("sends bot messages with deterministic deduplication and mentions disabled", async () => {
    const requests: Request[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.method === "GET") {
        return json([]);
      }
      return json({
        id: ids.message,
        channel_id: ids.thread,
        content: "hello @everyone",
        nonce: "ac-0-0123456789abcdef",
      });
    };
    const client = new DiscordRestClient({ botToken: "test-token", fetch: fakeFetch });

    const result = await client.sendMessageReconciled({
      channelId: ids.thread,
      content: "hello @everyone",
      nonce: "ac-0-0123456789abcdef",
    });

    expect(result.reconciled).toBe(false);
    expect(requests.map((request) => request.method)).toEqual(["GET", "POST"]);
    expect(requests[1]?.headers.get("authorization")).toBe("Bot test-token");
    await expect(requests[1]?.json()).resolves.toEqual({
      content: "hello @everyone",
      nonce: "ac-0-0123456789abcdef",
      enforce_nonce: true,
      allowed_mentions: { parse: [] },
    });
  });

  it("reconciles an ambiguous network response instead of sending twice", async () => {
    let committed = false;
    let postCount = 0;
    const message = {
      id: ids.message,
      channel_id: ids.thread,
      content: "translated reply",
      nonce: "ac-0-fedcba9876543210",
    };
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "GET") {
        return json(committed ? [message] : []);
      }
      postCount += 1;
      committed = true;
      throw new TypeError("connection closed after upstream commit");
    };
    const client = new DiscordRestClient({ botToken: "test-token", fetch: fakeFetch });

    await expect(
      client.sendMessageReconciled({
        channelId: ids.thread,
        content: message.content,
        nonce: message.nonce,
      }),
    ).resolves.toEqual({ message, reconciled: true });
    expect(postCount).toBe(1);
  });

  it("surfaces rate-limit timing as retryable Workflow metadata", async () => {
    const fakeFetch: typeof fetch = async () =>
      json(
        { message: "You are being rate limited.", retry_after: 1.25, global: true },
        { status: 429, headers: { "content-type": "application/json" } },
      );
    const client = new DiscordRestClient({ botToken: "test-token", fetch: fakeFetch });

    const error = await client.getChannel(ids.thread).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DiscordRestError);
    expect(error).toMatchObject({
      status: 429,
      retryable: true,
      retryAfterMs: 1_250,
      globalRateLimit: true,
    });
  });

  it("does not retry or reconcile permanent authorization failures", async () => {
    let requestCount = 0;
    const fakeFetch: typeof fetch = async () => {
      requestCount += 1;
      return json({ message: "Missing Permissions", code: 50_013 }, { status: 403 });
    };
    const client = new DiscordRestClient({ botToken: "test-token", fetch: fakeFetch });

    const error = await client
      .sendMessageReconciled({
        channelId: ids.thread,
        content: "hello",
        nonce: "ac-0-0123456789abcdef",
      })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 403, discordCode: 50_013, retryable: false });
    expect(requestCount).toBe(1);
  });

  it("finds an existing forum thread by its starter correlation marker", async () => {
    const marker = createDiscordCorrelationMarker("conversation-thread");
    const methods: string[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      methods.push(request.method);
      if (request.url.endsWith(`/guilds/${ids.guild}/threads/active`)) {
        return json({ threads: [{ id: ids.thread, type: 11, parent_id: ids.forum }] });
      }
      if (request.url.endsWith(`/channels/${ids.thread}/messages/${ids.thread}`)) {
        return json({
          id: ids.thread,
          channel_id: ids.thread,
          content: `Support context\nReference: ${marker}`,
        });
      }
      throw new Error(`Unexpected request: ${request.url}`);
    };
    const client = new DiscordRestClient({ botToken: "test-token", fetch: fakeFetch });

    const result = await client.createForumThreadReconciled({
      guildId: ids.guild,
      forumChannelId: ids.forum,
      correlationMarker: marker,
      name: "Canto support",
      starterContent: `Reference: ${marker}`,
    });

    expect(result).toMatchObject({ reconciled: true, thread: { id: ids.thread } });
    expect(methods).toEqual(["GET", "GET"]);
  });

  it("creates a forum starter with mentions disabled when reconciliation misses", async () => {
    const marker = createDiscordCorrelationMarker("new-conversation-thread");
    const requests: Request[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.url.endsWith(`/guilds/${ids.guild}/threads/active`)) {
        return json({ threads: [] });
      }
      if (request.url.includes(`/channels/${ids.forum}/threads/archived/public`)) {
        return json({ threads: [] });
      }
      return json({
        id: ids.thread,
        type: 11,
        parent_id: ids.forum,
        message: {
          id: ids.thread,
          channel_id: ids.thread,
          content: `Reference: ${marker}`,
        },
      });
    };
    const client = new DiscordRestClient({ botToken: "test-token", fetch: fakeFetch });

    await client.createForumThreadReconciled({
      guildId: ids.guild,
      forumChannelId: ids.forum,
      correlationMarker: marker,
      name: "Canto support",
      starterContent: `Reference: ${marker}`,
    });

    const create = requests.find((request) => request.method === "POST");
    await expect(create?.json()).resolves.toEqual({
      name: "Canto support",
      message: {
        content: `Reference: ${marker}`,
        allowed_mentions: { parse: [] },
      },
    });
  });
});
