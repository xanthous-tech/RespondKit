import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { RespondKitWidget } from "./respondkit-widget";
import { browserIdentityKey } from "./browser-identity";

function harness(lifetime = 300_000) {
  const sessions: Array<{
    installationId: string;
    identityToken?: string;
    context: { userId?: string };
  }> = [];
  const threads: Array<{
    id: string;
    clientThreadId: string;
    state: "open";
    createdAt: string;
    updatedAt: string;
  }> = [];
  let logouts = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    if (url.pathname === "/v1/client/sessions") {
      const body = JSON.parse(
        typeof init?.body === "string" ? init.body : "{}",
      ) as (typeof sessions)[number];
      sessions.push(body);
      return json({
        session: {
          id: "session_test",
          visitorId: "visitor_test",
          token: `session_token_test_${sessions.length}`,
          expiresAt: new Date(Date.now() + lifetime).toISOString(),
        },
      });
    }
    if (url.pathname === "/v1/client/logout") {
      logouts += 1;
      return json({ ok: true });
    }
    if (url.pathname === "/v1/threads" && init?.method === "GET") return json({ threads });
    if (url.pathname === "/v1/threads") {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as {
        clientThreadId: string;
      };
      const thread = {
        id: `thread_${threads.length}`,
        clientThreadId: body.clientThreadId,
        state: "open" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      threads.push(thread);
      return json({ thread });
    }
    const threadId = url.pathname.split("/")[3];
    return json({
      threadId,
      messages: [
        {
          id: `message_${threadId}`,
          threadId,
          direction: "operator_to_customer",
          text: `History for ${threadId}`,
          language: "en",
          acceptedAt: new Date().toISOString(),
          state: "available",
        },
      ],
      nextCursor: "1",
      hasMore: false,
    });
  });
  return { fetch, sessions, threads, logouts: () => logouts };
}
const base = { apiBaseUrl: "https://support.test", context: { inboxId: "inbox_test" } };
beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe("customer identity lifecycle", () => {
  it("links on login while closed, preserves the browser identity and restores the conversation", async () => {
    const api = harness();
    const getIdentityToken = vi.fn(async () => "signed_alice");
    const view = render(
      <RespondKitWidget
        {...base}
        fetch={api.fetch}
        getIdentityToken={getIdentityToken}
        initiallyOpen
      />,
    );
    expect(await screen.findByText("History for thread_0")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close support chat", expanded: true }));
    view.rerender(
      <RespondKitWidget
        {...base}
        context={{ inboxId: "inbox_test", userId: "alice" }}
        fetch={api.fetch}
        getIdentityToken={getIdentityToken}
      />,
    );
    await waitFor(() => expect(api.sessions.at(-1)?.identityToken).toBe("signed_alice"));
    expect(new Set(api.sessions.map((s) => s.installationId)).size).toBe(1);
    expect(api.threads).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open support chat" }));
    expect(await screen.findByText("History for thread_0")).toBeVisible();
  });

  it("restores account history after browser storage is cleared without creating an empty thread", async () => {
    const api = harness();
    api.threads.push({
      id: "thread_previous",
      clientThreadId: "client_thread_previous",
      state: "open",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    render(
      <RespondKitWidget
        {...base}
        context={{ inboxId: "inbox_test", userId: "alice" }}
        fetch={api.fetch}
        getIdentityToken={async () => "signed_alice"}
        initiallyOpen
      />,
    );
    expect(await screen.findByText("History for thread_previous")).toBeVisible();
    expect(api.threads).toHaveLength(1);
  });

  it("pauses during auth loading and rotates the visitor on logout even with chat closed", async () => {
    const api = harness();
    const getIdentityToken = async () => "signed_alice";
    const view = render(
      <RespondKitWidget
        {...base}
        context={{ inboxId: "inbox_test", userId: "alice" }}
        fetch={api.fetch}
        getIdentityToken={getIdentityToken}
      />,
    );
    await waitFor(() => expect(api.sessions).toHaveLength(1));
    const first = api.sessions[0]?.installationId;
    view.rerender(
      <RespondKitWidget
        {...base}
        identityPending
        fetch={api.fetch}
        getIdentityToken={getIdentityToken}
      />,
    );
    await act(async () => {});
    expect(api.logouts()).toBe(0);
    view.rerender(
      <RespondKitWidget {...base} fetch={api.fetch} getIdentityToken={getIdentityToken} />,
    );
    await waitFor(() => expect(api.logouts()).toBe(1));
    const saved = JSON.parse(
      localStorage.getItem(browserIdentityKey(base.apiBaseUrl, base.context.inboxId))!,
    ) as { installationId: string; userId?: string };
    expect(saved.installationId).not.toBe(first);
    expect(saved.userId).toBeUndefined();
  });

  it("does not fall back to anonymous access when account verification fails", async () => {
    const api = harness();
    render(
      <RespondKitWidget
        {...base}
        context={{ inboxId: "inbox_test", userId: "alice" }}
        fetch={api.fetch}
        getIdentityToken={async () => null}
        initiallyOpen
      />,
    );
    expect(await screen.findByText("Sign in again to restore your support history.")).toBeVisible();
    expect(api.sessions).toHaveLength(0);
  });

  it("keeps conversations separate and allows selecting older history", async () => {
    const api = harness();
    for (const id of ["older", "newer"])
      api.threads.push({
        id: `thread_${id}`,
        clientThreadId: `client_thread_${id}`,
        state: "open",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: id === "older" ? "2026-01-01T00:00:00.000Z" : "2026-02-01T00:00:00.000Z",
      });
    render(
      <RespondKitWidget
        {...base}
        context={{ inboxId: "inbox_test", userId: "alice" }}
        fetch={api.fetch}
        getIdentityToken={async () => "signed_alice"}
        initiallyOpen
      />,
    );
    expect(await screen.findByText("History for thread_newer")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Conversation"), { target: { value: "thread_older" } });
    expect(await screen.findByText("History for thread_older")).toBeVisible();
    expect(screen.queryByText("History for thread_newer")).not.toBeInTheDocument();
  });

  it.each(["identity", "clear"])(
    "hides account history after another tab performs %s",
    async (change) => {
      const api = harness();
      render(
        <RespondKitWidget
          {...base}
          context={{ inboxId: "inbox_test", userId: "alice" }}
          fetch={api.fetch}
          getIdentityToken={async () => "signed_alice"}
          initiallyOpen
        />,
      );
      expect(await screen.findByText("History for thread_0")).toBeVisible();
      fireEvent(
        window,
        new StorageEvent("storage", {
          key:
            change === "clear" ? null : browserIdentityKey(base.apiBaseUrl, base.context.inboxId),
          oldValue: JSON.stringify({ installationId: "old", userId: "alice" }),
          newValue: JSON.stringify({ installationId: "new" }),
        }),
      );
      expect(screen.queryByText("History for thread_0")).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
      expect(screen.getByText(/Support identity changed in another tab/)).toBeVisible();
    },
  );
  it("refreshes account credentials without clearing the current transcript", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const api = harness();
    const getIdentityToken = vi.fn(async () => "signed_alice");
    api.threads.push(
      ...["older", "newer"].map((id) => ({
        id: `thread_${id}`,
        clientThreadId: `client_thread_${id}`,
        state: "open" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: id === "older" ? "2026-01-01T00:00:00.000Z" : "2026-02-01T00:00:00.000Z",
      })),
    );
    render(
      <RespondKitWidget
        {...base}
        context={{ inboxId: "inbox_test", userId: "alice" }}
        fetch={api.fetch}
        getIdentityToken={getIdentityToken}
        initiallyOpen
      />,
    );
    await vi.waitFor(() => expect(screen.getByText("History for thread_newer")).toBeVisible());
    fireEvent.change(screen.getByLabelText("Conversation"), { target: { value: "thread_older" } });
    await vi.waitFor(() => expect(screen.getByText("History for thread_older")).toBeVisible());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(270_000);
    });
    expect(getIdentityToken).toHaveBeenCalledTimes(2);
    expect(api.sessions).toHaveLength(2);
    expect(api.sessions[1]?.installationId).toBe(api.sessions[0]?.installationId);
    expect(screen.getByText("History for thread_older")).toBeVisible();
    expect(screen.queryByLabelText("Loading messages")).not.toBeInTheDocument();
  });

  it("imports a legacy account installation only with its signed account assertion", async () => {
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode("alice")),
    );
    const scope = Array.from(digest.slice(0, 16), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const key = `respondkit:inbox_test:user-${scope}:installation-id`;
    localStorage.setItem(key, "install_legacy_alice");
    const api = harness();
    render(
      <RespondKitWidget
        {...base}
        context={{ inboxId: "inbox_test", userId: "alice" }}
        fetch={api.fetch}
        getIdentityToken={async () => "signed_alice"}
        initiallyOpen
      />,
    );
    expect(await screen.findByText("History for thread_0")).toBeVisible();
    expect(api.sessions[0]).toMatchObject({
      installationId: "install_legacy_alice",
      identityToken: "signed_alice",
      context: { userId: "alice" },
    });
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("does not repeatedly refresh a thirty-day anonymous session", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const api = harness(30 * 24 * 60 * 60 * 1000);
    render(<RespondKitWidget {...base} fetch={api.fetch} initiallyOpen />);
    await vi.waitFor(() => expect(screen.getByText("History for thread_0")).toBeVisible());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(api.sessions).toHaveLength(1);
  });
});
