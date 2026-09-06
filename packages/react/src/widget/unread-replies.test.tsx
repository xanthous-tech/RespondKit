import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { RespondKitWidget } from "./respondkit-widget";
import { browserIdentityKey } from "./browser-identity";

const base = { apiBaseUrl: "https://unread.test", context: { inboxId: "inbox_unread" } };
const key = browserIdentityKey(base.apiBaseUrl, base.context.inboxId);
const readKey = `${key}:read:visitor_unread:thread_one`;
const stamp = "2026-01-01T00:00:00.000Z";
function thread(id: string) {
  return { id, clientThreadId: `client_${id}`, state: "open", createdAt: stamp, updatedAt: stamp };
}
function harness() {
  const threads = [thread("thread_one")];
  const replies = new Map([["thread_one", 0]]);
  const transcriptCursors = new Map<string, number>();
  const state = {
    failMessages: false,
    failStatus: false,
    statusCalls: 0,
    messageCalls: 0,
    sessions: 0,
  };
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.pathname === "/v1/client/sessions") {
      state.sessions++;
      return json({
        session: {
          id: "session_unread",
          visitorId: "visitor_unread",
          token: "session_token_unread",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      });
    }
    if (url.pathname === "/v1/thread-statuses") {
      state.statusCalls++;
      if (state.failStatus) throw new Error("Offline");
      const index = url.searchParams.has("after") ? 1 : 0;
      return json({
        threads: [
          {
            thread: threads[index],
            latestReplyCursor: String(replies.get(threads[index]!.id) ?? 0),
          },
        ],
        ...(index === 0 && threads.length > 1 ? { nextCursor: threads[0]!.id } : {}),
      });
    }
    if (url.pathname === "/v1/threads" && init?.method === "GET") return json({ threads });
    if (url.pathname === "/v1/client/logout") return json({ ok: true });
    if (url.pathname.endsWith("/messages")) {
      state.messageCalls++;
      if (state.failMessages) throw new Error("Offline");
      const id = url.pathname.split("/")[3]!;
      const cursor = transcriptCursors.get(id) ?? replies.get(id) ?? 0;
      const after = Number(url.searchParams.get("after"));
      return json({
        threadId: id,
        messages:
          cursor > after
            ? [
                {
                  id: `message_${id}_${cursor}`,
                  threadId: id,
                  direction: "operator_to_customer",
                  state: "available",
                  text: `Reply ${id} ${cursor}`,
                  acceptedAt: stamp,
                },
              ]
            : [],
        nextCursor: String(cursor),
        hasMore: false,
      });
    }
    return json({ thread: threads.find((item) => url.pathname.endsWith(item.id)) ?? threads[0] });
  });
  return { fetch, state, threads, replies, transcriptCursors };
}
async function tick(ms = 10_000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function close() {
  fireEvent.click(screen.getByRole("button", { name: "Close support chat", expanded: true }));
}
function open() {
  fireEvent.click(screen.getByRole("button", { name: "Open support chat" }));
}
const dot = () => screen.queryByTestId("unread-reply-dot");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  localStorage.clear();
  localStorage.setItem(
    key,
    JSON.stringify({
      installationId: "install_unread",
      clientThreadId: "client_thread_one",
      selectedThreadId: "thread_one",
    }),
  );
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("unread operator replies", () => {
  it("resumes a closed anonymous conversation, polls without downloading messages, and remembers reads after reload", async () => {
    const api = harness();
    let view = render(<RespondKitWidget {...base} fetch={api.fetch} />);
    await vi.waitFor(() => expect(api.state.statusCalls).toBe(1));
    expect(dot()).not.toBeInTheDocument();
    api.replies.set("thread_one", 3);
    await tick();
    expect(dot()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open support chat" })).toHaveAccessibleDescription(
      "Unread support reply",
    );
    expect(api.state.messageCalls).toBe(0);
    view.unmount();
    view = render(<RespondKitWidget {...base} fetch={api.fetch} />);
    await vi.waitFor(() => expect(dot()).toBeInTheDocument());
    open();
    await vi.waitFor(() => expect(screen.getByText("Reply thread_one 3")).toBeVisible());
    expect(dot()).not.toBeInTheDocument();
    expect(localStorage.getItem(readKey)).toBe("3");
    close();
    view.unmount();
    render(<RespondKitWidget {...base} fetch={api.fetch} />);
    await vi.waitFor(() => expect(api.state.sessions).toBe(3));
    await tick();
    expect(dot()).not.toBeInTheDocument();
    api.replies.set("thread_one", 4);
    await tick();
    expect(dot()).toBeInTheDocument();
  });

  it("keeps the dot when opening fails to fetch the reply, then clears it after recovery", async () => {
    const api = harness();
    api.replies.set("thread_one", 1);
    api.state.failMessages = true;
    render(<RespondKitWidget {...base} fetch={api.fetch} />);
    await vi.waitFor(() => expect(dot()).toBeInTheDocument());
    open();
    await vi.waitFor(() => expect(api.state.messageCalls).toBe(1));
    expect(dot()).toBeInTheDocument();
    expect(localStorage.getItem(readKey)).toBeNull();
    api.state.failMessages = false;
    await tick(2000);
    expect(screen.getByText("Reply thread_one 1")).toBeVisible();
    expect(dot()).not.toBeInTheDocument();
  });

  it("does not acknowledge a newer status cursor before its reply is in the transcript", async () => {
    const api = harness();
    api.replies.set("thread_one", 2);
    api.transcriptCursors.set("thread_one", 1);
    render(<RespondKitWidget {...base} fetch={api.fetch} initiallyOpen />);
    await vi.waitFor(() => expect(screen.getByText("Reply thread_one 1")).toBeVisible());
    expect(dot()).toBeInTheDocument();
    expect(localStorage.getItem(readKey)).toBe("1");
    api.transcriptCursors.set("thread_one", 2);
    await tick(2000);
    expect(dot()).not.toBeInTheDocument();
  });

  it("checks every history page and keeps older conversations unread until selected", async () => {
    const api = harness();
    api.threads.push(thread("thread_two"));
    api.replies.set("thread_two", 1);
    render(<RespondKitWidget {...base} fetch={api.fetch} />);
    await vi.waitFor(() => expect(dot()).toBeInTheDocument());
    open();
    await vi.waitFor(() => expect(screen.getByLabelText("Conversation")).toBeVisible());
    expect(screen.getByRole("option", { name: /Unread reply/ })).toHaveValue("thread_two");
    expect(dot()).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Conversation"), { target: { value: "thread_two" } });
    await vi.waitFor(() => expect(screen.getByText("Reply thread_two 1")).toBeVisible());
    expect(dot()).not.toBeInTheDocument();
  });

  it("pauses in hidden tabs, resumes immediately on return, and retains unread state through network failures", async () => {
    const api = harness();
    render(<RespondKitWidget {...base} fetch={api.fetch} />);
    await vi.waitFor(() => expect(api.state.statusCalls).toBe(1));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    api.replies.set("thread_one", 1);
    await tick(30_000);
    expect(api.state.statusCalls).toBe(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fireEvent(document, new Event("visibilitychange"));
    await vi.waitFor(() => expect(dot()).toBeInTheDocument());
    api.state.failStatus = true;
    await tick();
    expect(dot()).toBeInTheDocument();
    api.state.failStatus = false;
    localStorage.setItem(readKey, "1");
    fireEvent(window, new StorageEvent("storage", { key: readKey, newValue: "1" }));
    expect(dot()).not.toBeInTheDocument();
  });

  it.each(["pending", "logout", "other-tab"])(
    "hides unread account activity during %s",
    async (change) => {
      const api = harness();
      api.replies.set("thread_one", 1);
      const props = {
        ...base,
        context: { inboxId: "inbox_unread", userId: "alice" },
        getIdentityToken: async () => "signed_alice",
        fetch: api.fetch,
      };
      const view = render(<RespondKitWidget {...props} />);
      await vi.waitFor(() => expect(dot()).toBeInTheDocument());
      const calls = api.state.statusCalls;
      if (change === "pending") view.rerender(<RespondKitWidget {...props} identityPending />);
      else if (change === "logout")
        view.rerender(<RespondKitWidget {...props} context={base.context} />);
      else fireEvent(window, new StorageEvent("storage", { key: null }));
      expect(dot()).not.toBeInTheDocument();
      await tick();
      expect(api.state.statusCalls).toBe(calls);
    },
  );

  it("can acknowledge replies when storage is readable but writes fail", async () => {
    const api = harness();
    api.replies.set("thread_one", 10);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    render(<RespondKitWidget {...base} fetch={api.fetch} />);
    await vi.waitFor(() => expect(dot()).toBeInTheDocument());
    open();
    await vi.waitFor(() => expect(screen.getByText("Reply thread_one 10")).toBeVisible());
    expect(dot()).not.toBeInTheDocument();
    close();
    await tick();
    expect(dot()).not.toBeInTheDocument();
  });

  it("does not create a support session on untouched anonymous pages", async () => {
    localStorage.clear();
    const api = harness();
    render(<RespondKitWidget {...base} fetch={api.fetch} />);
    await tick();
    expect(api.fetch).not.toHaveBeenCalled();
  });
});
