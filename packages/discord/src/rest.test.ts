import { describe, expect, it, vi } from "vite-plus/test";

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

function unreadableJson(value: unknown): Response {
  const response = json(value);
  Object.defineProperty(response, "text", {
    value: async () => {
      throw new TypeError("response stream closed after upstream commit");
    },
  });
  return response;
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
  it("adds a bot reaction using Discord's empty 204 response", async () => {
    const requests: Request[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(null, { status: 204 });
    };
    const client = new DiscordRestClient({ botToken: "test-token", fetch: fakeFetch });

    await expect(
      client.addReaction({ channelId: ids.thread, messageId: ids.message, emoji: "✅" }),
    ).resolves.toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("PUT");
    expect(requests[0]?.url).toBe(
      `https://discord.com/api/v10/channels/${ids.thread}/messages/${ids.message}/reactions/%E2%9C%85/@me`,
    );
    expect(requests[0]?.headers.get("authorization")).toBe("Bot test-token");
  });

  it("calls the runtime fetch implementation with its required global receiver", async () => {
    const nativeStyleFetch = async function (
      this: typeof globalThis,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ): Promise<Response> {
      if (this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return json({ id: ids.thread, type: 11 });
    };
    vi.stubGlobal("fetch", nativeStyleFetch);

    try {
      const client = new DiscordRestClient({ botToken: "test-token" });

      await expect(client.getChannel(ids.thread)).resolves.toMatchObject({ id: ids.thread });
    } finally {
      vi.unstubAllGlobals();
    }
  });

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

  it("reconciles a message when its successful response body cannot be read", async () => {
    let committed = false;
    const message = {
      id: ids.message,
      channel_id: ids.thread,
      content: "translated reply",
      nonce: "ac-0-fedcba9876543211",
    };
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "GET") {
        return json(committed ? [message] : []);
      }
      committed = true;
      return unreadableJson(message);
    };
    const client = new DiscordRestClient({ botToken: "test-token", fetch: fakeFetch });

    await expect(
      client.sendMessageReconciled({
        channelId: ids.thread,
        content: message.content,
        nonce: message.nonce,
      }),
    ).resolves.toEqual({ message, reconciled: true });
  });

  it("rejects a malformed successful message before it can be checkpointed", async () => {
    const fakeFetch: typeof fetch = async () =>
      json({
        id: ids.message,
        channel_id: ids.thread,
        content: "translated reply",
      });
    const client = new DiscordRestClient({ botToken: "test-token", fetch: fakeFetch });

    const error = await client
      .sendMessage({
        channelId: ids.thread,
        content: "translated reply",
        nonce: "ac-0-fedcba9876543212",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DiscordRestError);
    expect(error).toMatchObject({ status: 200, retryable: true });
    expect((error as Error).message).toContain("invalid successful response");
  });

  it("rejects a nonce reconciliation whose canonical content differs", async () => {
    const fakeFetch: typeof fetch = async () =>
      json([
        {
          id: ids.message,
          channel_id: ids.thread,
          content: "an older projection",
          nonce: "ac-0-fedcba9876543213",
        },
      ]);
    const client = new DiscordRestClient({ botToken: "test-token", fetch: fakeFetch });

    const error = await client
      .sendMessageReconciled({
        channelId: ids.thread,
        content: "a changed projection",
        nonce: "ac-0-fedcba9876543213",
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DiscordRestError);
    expect(error).toMatchObject({ retryable: false });
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
      name: "Example Product support",
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
      name: "Example Product support",
      starterContent: `Reference: ${marker}`,
    });

    const create = requests.find((request) => request.method === "POST");
    await expect(create?.json()).resolves.toEqual({
      name: "Example Product support",
      message: {
        content: `Reference: ${marker}`,
        allowed_mentions: { parse: [] },
      },
    });
  });

  it("reconciles a forum thread when its successful response body cannot be read", async () => {
    const marker = createDiscordCorrelationMarker("unreadable-forum-response");
    const starter = {
      id: ids.thread,
      channel_id: ids.thread,
      content: `Reference: ${marker}`,
    };
    const thread = { id: ids.thread, type: 11, parent_id: ids.forum };
    let committed = false;
    let postCount = 0;
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url.endsWith(`/guilds/${ids.guild}/threads/active`)) {
        return json({ threads: committed ? [thread] : [] });
      }
      if (request.url.includes(`/channels/${ids.forum}/threads/archived/public`)) {
        return json({ threads: [] });
      }
      if (request.url.endsWith(`/channels/${ids.thread}/messages/${ids.thread}`)) {
        return json(starter);
      }
      postCount += 1;
      committed = true;
      return unreadableJson({ ...thread, message: starter });
    };
    const client = new DiscordRestClient({ botToken: "test-token", fetch: fakeFetch });

    await expect(
      client.createForumThreadReconciled({
        guildId: ids.guild,
        forumChannelId: ids.forum,
        correlationMarker: marker,
        name: "Example Product support",
        starterContent: starter.content,
      }),
    ).resolves.toEqual({ thread, starterMessage: starter, reconciled: true });
    expect(postCount).toBe(1);
  });

  it("rejects a malformed successful forum thread before it can be checkpointed", async () => {
    const marker = createDiscordCorrelationMarker("malformed-forum-response");
    const fakeFetch: typeof fetch = async () =>
      json({
        id: ids.thread,
        type: 11,
        parent_id: ids.forum,
        message: {
          id: ids.message,
          channel_id: ids.thread,
          content: `Reference: ${marker}`,
        },
      });
    const client = new DiscordRestClient({ botToken: "test-token", fetch: fakeFetch });

    const error = await client
      .createForumThread({
        forumChannelId: ids.forum,
        name: "Example Product support",
        starterContent: `Reference: ${marker}`,
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DiscordRestError);
    expect(error).toMatchObject({ status: 200, retryable: true });
  });

  it("checks archived threads even when active candidates fill the scan budget", async () => {
    const marker = createDiscordCorrelationMarker("archived-beyond-active-cap");
    const activeIds = ["100000000000000005", "100000000000000006"];
    const archivedId = "100000000000000007";
    const fakeFetch: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url.endsWith(`/guilds/${ids.guild}/threads/active`)) {
        return json({
          threads: activeIds.map((id) => ({ id, type: 11, parent_id: ids.forum })),
        });
      }
      if (request.url.includes(`/channels/${ids.forum}/threads/archived/public`)) {
        return json({
          threads: [{ id: archivedId, type: 11, parent_id: ids.forum }],
        });
      }
      if (request.url.endsWith(`/channels/${archivedId}/messages/${archivedId}`)) {
        return json({
          id: archivedId,
          channel_id: archivedId,
          content: `Reference: ${marker}`,
        });
      }
      const activeId = activeIds.find((id) =>
        request.url.endsWith(`/channels/${id}/messages/${id}`),
      );
      if (activeId !== undefined) {
        return json({ id: activeId, channel_id: activeId, content: "another conversation" });
      }
      throw new Error(`Unexpected request: ${request.url}`);
    };
    const client = new DiscordRestClient({ botToken: "test-token", fetch: fakeFetch });

    await expect(
      client.findForumThreadByCorrelationMarker({
        guildId: ids.guild,
        forumChannelId: ids.forum,
        correlationMarker: marker,
        maximumCandidates: 2,
      }),
    ).resolves.toMatchObject({ thread: { id: archivedId } });
  });
});
