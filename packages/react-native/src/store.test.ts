import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  RespondKitClientError,
  type RespondKitClient,
  type MessageV1,
  type ThreadV1,
} from "@respondkit/api-client";
import { memoryPersistence, RespondKitStore, type RespondKitPersistence } from "./store";

const thread: ThreadV1 = {
  id: "thread_one",
  clientThreadId: "cthread_one",
  state: "open",
  createdAt: "2026-10-01T01:00:00Z",
  updatedAt: "2026-10-01T01:00:00Z",
};
const reply: MessageV1 = {
  id: "msg_reply",
  threadId: thread.id,
  direction: "operator_to_customer",
  text: "Your export is ready.",
  acceptedAt: "2026-10-01T02:00:00Z",
  state: "available",
};
let counter = 0;
const stores: RespondKitStore[] = [];
afterEach(() => {
  for (const store of stores) store.dispose();
  stores.length = 0;
  vi.useRealTimers();
});
function api() {
  return {
    createSession: vi.fn().mockResolvedValue({
      session: {
        id: "session_one",
        token: "session_long_token_123",
        visitorId: "visitor_one",
        expiresAt: "2099-01-01T00:00:00Z",
      },
    }),
    listThreadStatuses: vi.fn().mockResolvedValue({ threads: [] }),
    listThreads: vi.fn(),
    getThread: vi.fn(),
    getContact: vi.fn().mockResolvedValue({}),
    saveContact: vi.fn().mockResolvedValue({ email: "customer@example.com" }),
    createThread: vi
      .fn()
      .mockImplementation(async (_token, request: { clientThreadId: string }) => ({
        thread: { ...thread, clientThreadId: request.clientThreadId },
      })),
    listMessages: vi
      .fn()
      .mockResolvedValue({ threadId: thread.id, messages: [], nextCursor: "0", hasMore: false }),
    sendMessage: vi
      .fn()
      .mockImplementation(async (_token, _thread, request: { clientMessageId: string }) => ({
        acceptance: {
          messageId: "msg_one",
          clientMessageId: request.clientMessageId,
          status: "accepted",
        },
      })),
    markThreadRead: vi.fn().mockResolvedValue({ ok: true }),
    logout: vi.fn().mockResolvedValue({ ok: true }),
  } satisfies RespondKitClient;
}
async function make(client = api(), persistence = memoryPersistence(), userId?: string) {
  const store = await RespondKitStore.create({
    apiBaseUrl: "https://api.example.com",
    inboxId: "inbox_test",
    origin: "https://app.example.com",
    persistence,
    createId: (prefix) => `${prefix}_${++counter}`,
    client,
    context: userId ? { userId } : {},
  });
  stores.push(store);
  return store;
}
function history(client: ReturnType<typeof api>) {
  client.listThreadStatuses.mockResolvedValue({ threads: [{ thread, latestReplyCursor: "10" }] });
  client.listMessages.mockResolvedValue({
    threadId: thread.id,
    messages: [reply],
    nextCursor: "10",
    hasMore: false,
  });
}

describe("React Native store", () => {
  it("creates a conversation only on first send and keeps the greeting local", async () => {
    const client = api();
    const store = await make(client);
    await store.openConversation();
    expect(client.createThread).not.toHaveBeenCalled();
    expect(store.getSnapshot().fresh).toBe(true);
    await store.setDraft("Hello");
    await store.sendDraft();
    expect(client.createThread).toHaveBeenCalledTimes(1);
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().fresh).toBe(true);
    expect(store.getSnapshot().draft).toBe("");
    expect(store.getSnapshot().pending[0]?.text).toBe("Hello");
  });
  it("persists ambiguous immutable sends and retries the same ID and text after restart", async () => {
    const client = api();
    const persistence = memoryPersistence();
    const store = await make(client, persistence);
    await store.openConversation();
    await store.setDraft("Original payload");
    client.sendMessage.mockRejectedValueOnce(
      new RespondKitClientError("Disconnected", { code: "acceptance_unknown", retryable: true }),
    );
    await store.sendDraft();
    const first = client.sendMessage.mock.calls[0];
    expect(store.getSnapshot().pending[0]?.delivery).toBe("acceptance_unknown");
    const restored = await make(client, persistence);
    expect(restored.getSnapshot().fresh).toBe(false);
    store.setForeground(false);
    await restored.retry(restored.getSnapshot().pending[0]!.id);
    expect(client.sendMessage.mock.calls[1]).toEqual(first);
    expect(restored.getSnapshot().pending[0]?.delivery).toBe("accepted");
  });
  it("keeps drafts across restart and isolates all cached history on account change", async () => {
    const client = api();
    history(client);
    const persistence = memoryPersistence();
    const store = await make(client, persistence, "alice");
    await store.openConversation();
    await store.setDraft("Private draft");
    const restored = await make(client, persistence, "alice");
    expect(restored.getSnapshot().draft).toBe("Private draft");
    const change = restored.updateIdentity({ userId: "bob" });
    expect(restored.getSnapshot().messages).toEqual([]);
    expect(restored.getSnapshot().draft).toBe("");
    expect(restored.getSnapshot().unreadThreadIds.size).toBe(0);
    await change;
  });
  it("rejects late account responses", async () => {
    const client = api();
    let finish!: (value: unknown) => void;
    client.listThreadStatuses.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const store = await make(client, memoryPersistence(), "alice");
    const refresh = store.openConversation();
    await vi.waitFor(() => expect(finish).toBeDefined());
    const change = store.updateIdentity({ userId: "bob" });
    finish({ threads: [{ thread, latestReplyCursor: "10" }] });
    await refresh;
    await change;
    expect(store.getSnapshot().messages).toEqual([]);
    expect(store.getSnapshot().threads).toEqual([]);
  });
  it("does not acknowledge closed/background chats or stale cursors, and retries read failures", async () => {
    const client = api();
    history(client);
    const store = await make(client);
    await store.openConversation();
    await store.markDisplayed(thread.id, "10");
    expect(client.markThreadRead).not.toHaveBeenCalled();
    store.setForeground(true);
    await store.refresh();
    await store.markDisplayed(thread.id, "11");
    expect(client.markThreadRead).not.toHaveBeenCalled();
    client.markThreadRead.mockRejectedValueOnce(new Error("Offline"));
    await store.markDisplayed(thread.id, "10");
    expect(store.getSnapshot().unreadThreadIds.size).toBe(0);
    store.closeConversation();
    await store.refresh();
    expect(client.markThreadRead).toHaveBeenCalledTimes(2);
  });
  it("loads all history and transcript pages and replaces message revisions", async () => {
    const client = api();
    client.listThreadStatuses
      .mockResolvedValueOnce({
        threads: [{ thread, latestReplyCursor: "10" }],
        nextCursor: "page2",
      })
      .mockResolvedValueOnce({ threads: [] });
    client.listMessages
      .mockResolvedValueOnce({
        threadId: thread.id,
        messages: [{ ...reply, text: "Earlier" }],
        nextCursor: "1",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        threadId: thread.id,
        messages: [reply],
        nextCursor: "10",
        hasMore: false,
      });
    const store = await make(client);
    await store.openConversation();
    expect(client.listThreadStatuses).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().messages).toEqual([reply]);
    expect(store.getSnapshot().fresh).toBe(false);
  });
  it("renews expired sessions once and preserves the conversation", async () => {
    const client = api();
    history(client);
    client.listThreadStatuses.mockRejectedValueOnce(
      new RespondKitClientError("Expired", { code: "unauthorized", status: 401, retryable: false }),
    );
    const store = await make(client);
    await store.openConversation();
    expect(client.createSession).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().messages).toEqual([reply]);
  });
  it("restores known email and captures missing contact without chat ingress", async () => {
    const client = api();
    client.getContact.mockResolvedValue({ email: "known@example.com" });
    const store = await make(client);
    await store.openConversation();
    expect(store.getSnapshot().email).toBe("known@example.com");
    await store.saveEmail("customer@example.com");
    expect(store.getSnapshot().email).toBe("customer@example.com");
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
  it("fails closed on corrupt storage and never sends before pending data is saved", async () => {
    await expect(
      make(api(), { load: async () => "bad json", save: async () => undefined }),
    ).rejects.toThrow();
    const backing = memoryPersistence();
    let fail = false;
    const persistence: RespondKitPersistence = {
      load: () => backing.load(),
      save: async (data) => {
        if (fail) throw new Error("Storage failed");
        await backing.save(data);
      },
    };
    const client = api();
    const store = await make(client, persistence);
    await store.openConversation();
    fail = true;
    await store.setDraft("Keep me");
    await store.sendDraft();
    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(store.getSnapshot().error).toContain("Storage failed");
  });
  it("prevents duplicate taps and blocks oversized messages", async () => {
    const client = api();
    const store = await make(client);
    await store.openConversation();
    await store.setDraft("x".repeat(6001));
    await store.sendDraft();
    expect(client.sendMessage).not.toHaveBeenCalled();
    await store.setDraft("Hello");
    await Promise.all([store.sendDraft(), store.sendDraft()]);
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });
});

it("pauses polling in the background without multiplying timers on resume", async () => {
  vi.useFakeTimers();
  const client = api();
  const store = await make(client);
  store.setForeground(true);
  await store.refresh();
  store.setForeground(false);
  store.setForeground(true);
  await store.refresh();
  client.listThreadStatuses.mockClear();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(client.listThreadStatuses).toHaveBeenCalledTimes(1);
  store.setForeground(false);
  client.listThreadStatuses.mockClear();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(client.listThreadStatuses).not.toHaveBeenCalled();
});

it("starts a new conversation after a closed thread and retains drafts per conversation", async () => {
  const client = api();
  history(client);
  client.listThreadStatuses.mockResolvedValue({
    threads: [{ thread: { ...thread, state: "closed" }, latestReplyCursor: "10" }],
  });
  const store = await make(client);
  await store.openConversation();
  await store.setDraft("Cannot send here");
  await store.sendDraft();
  expect(client.sendMessage).not.toHaveBeenCalled();
  await store.selectThread();
  expect(store.getSnapshot().fresh).toBe(true);
  expect(store.getSnapshot().draft).toBe("");
  await store.setDraft("New request");
  await store.sendDraft();
  expect(client.createThread).toHaveBeenCalledTimes(1);
});
