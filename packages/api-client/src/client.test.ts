import { describe, expect, it, vi } from "vite-plus/test";

import { AgentChatClientError, createAgentChatClient } from "./index";

const SESSION_TOKEN = "session_token_that_is_long_enough";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function acceptedResponse(status = "accepted") {
  return jsonResponse(
    {
      acceptance: {
        messageId: "msg_1",
        clientMessageId: "cmsg_1",
        status,
      },
    },
    { status: status === "acceptance_unknown" ? 503 : 202 },
  );
}

describe("Agent Chat API client", () => {
  it("builds authenticated cursor requests", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        threadId: "thread_1",
        messages: [],
        nextCursor: "90071992547409930000",
        hasMore: false,
      }),
    );
    const client = createAgentChatClient({ baseUrl: "https://chat.example.com/", fetch });

    const page = await client.listMessages(SESSION_TOKEN, "thread_1", {
      after: "90071992547409929999",
      limit: 50,
    });

    expect(page.nextCursor).toBe("90071992547409930000");
    expect(fetch).toHaveBeenCalledWith(
      "https://chat.example.com/v1/threads/thread_1/messages?after=90071992547409929999&limit=50",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: `Bearer ${SESSION_TOKEN}` }),
      }),
    );
  });

  it("retries a network ambiguity with the exact serialized message", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(acceptedResponse());
    const client = createAgentChatClient({
      baseUrl: "https://chat.example.com",
      fetch,
      acceptanceRetry: { attempts: 2, delayMs: 0, maxDelayMs: 0 },
    });

    const response = await client.sendMessage(SESSION_TOKEN, "thread_1", {
      clientMessageId: "cmsg_1",
      text: "မင်္ဂလာပါ",
    });

    expect(response.acceptance.status).toBe("accepted");
    expect(fetch).toHaveBeenCalledTimes(2);
    const firstBody = fetch.mock.calls[0]?.[1]?.body;
    const secondBody = fetch.mock.calls[1]?.[1]?.body;
    expect(firstBody).toBe(secondBody);
    expect(firstBody).toBe(JSON.stringify({ clientMessageId: "cmsg_1", text: "မင်္ဂလာပါ" }));
  });

  it("retries an explicit acceptance_unknown response with the same identity", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(acceptedResponse("acceptance_unknown"))
      .mockResolvedValueOnce(acceptedResponse("already_accepted"));
    const client = createAgentChatClient({
      baseUrl: "https://chat.example.com",
      fetch,
      acceptanceRetry: { attempts: 2, delayMs: 0, maxDelayMs: 0 },
    });

    const response = await client.sendMessage(SESSION_TOKEN, "thread_1", {
      clientMessageId: "cmsg_1",
      text: "สวัสดี",
    });

    expect(response.acceptance.status).toBe("already_accepted");
    expect(fetch.mock.calls.map((call) => call[1]?.body)).toEqual([
      JSON.stringify({ clientMessageId: "cmsg_1", text: "สวัสดี" }),
      JSON.stringify({ clientMessageId: "cmsg_1", text: "สวัสดี" }),
    ]);
  });

  it("returns the final explicit unknown result for caller reconciliation", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => acceptedResponse("acceptance_unknown"));
    const client = createAgentChatClient({
      baseUrl: "https://chat.example.com",
      fetch,
      acceptanceRetry: { attempts: 2, delayMs: 0, maxDelayMs: 0 },
    });

    const response = await client.sendMessage(SESSION_TOKEN, "thread_1", {
      clientMessageId: "cmsg_1",
      text: "hello",
    });

    expect(response.acceptance).toMatchObject({
      clientMessageId: "cmsg_1",
      status: "acceptance_unknown",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects a response for a different immutable message identity", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse(
        {
          acceptance: {
            messageId: "msg_other",
            clientMessageId: "cmsg_other",
            status: "accepted",
          },
        },
        { status: 202 },
      ),
    );
    const client = createAgentChatClient({ baseUrl: "https://chat.example.com", fetch });

    await expect(
      client.sendMessage(SESSION_TOKEN, "thread_1", {
        clientMessageId: "cmsg_1",
        text: "hello",
      }),
    ).rejects.toMatchObject({
      code: "internal_error",
      clientMessageId: "cmsg_1",
      retryable: false,
    });
  });

  it("treats a truncated POST response as ambiguous and retries unchanged", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("not json", { status: 202 }))
      .mockResolvedValueOnce(acceptedResponse("already_accepted"));
    const client = createAgentChatClient({
      baseUrl: "https://chat.example.com",
      fetch,
      acceptanceRetry: { attempts: 2, delayMs: 0, maxDelayMs: 0 },
    });

    const response = await client.sendMessage(SESSION_TOKEN, "thread_1", {
      clientMessageId: "cmsg_1",
      text: "hello",
    });

    expect(response.acceptance.status).toBe("already_accepted");
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(fetch.mock.calls[1]?.[1]?.body);
  });

  it("throws a typed acceptance_unknown after ambiguous transport exhaustion", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError("offline"));
    const client = createAgentChatClient({
      baseUrl: "https://chat.example.com",
      fetch,
      acceptanceRetry: { attempts: 2, delayMs: 0, maxDelayMs: 0 },
    });

    const promise = client.sendMessage(SESSION_TOKEN, "thread_1", {
      clientMessageId: "cmsg_1",
      text: "hello",
    });

    await expect(promise).rejects.toMatchObject({
      code: "acceptance_unknown",
      clientMessageId: "cmsg_1",
      retryable: true,
    });
    await expect(promise).rejects.toBeInstanceOf(AgentChatClientError);
  });

  it("does not retry a rejected immutable payload", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "invalid_request",
            message: "message is too long",
            retryable: false,
          },
        },
        { status: 400 },
      ),
    );
    const client = createAgentChatClient({ baseUrl: "https://chat.example.com", fetch });

    await expect(
      client.sendMessage(SESSION_TOKEN, "thread_1", {
        clientMessageId: "cmsg_1",
        text: "hello",
      }),
    ).rejects.toMatchObject({ code: "invalid_request", retryable: false, status: 400 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not resolve fetch or browser globals until a method is called", () => {
    expect(() =>
      createAgentChatClient({
        baseUrl: "/support",
        fetch: undefined,
        acceptanceRetry: { attempts: 1 },
      }),
    ).not.toThrow();
  });
});
