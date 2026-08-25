import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { AgentChatWidget } from "./agent-chat-widget";

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function requestBody(body: BodyInit | null | undefined) {
  if (typeof body !== "string") {
    throw new TypeError("Expected the API client to send a JSON string body");
  }
  return body;
}

function createApiFetch() {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(requestUrl(input));

    if (url.pathname === "/v1/client/sessions") {
      return json({
        session: {
          id: "session_test",
          token: "session_test_token_12345",
          visitorId: "visitor_test",
          expiresAt: "2026-08-26T00:00:00.000Z",
        },
      });
    }

    if (url.pathname === "/v1/threads") {
      const request = JSON.parse(requestBody(init?.body)) as {
        clientThreadId: string;
      };
      return json({
        thread: {
          id: "thread_test",
          clientThreadId: request.clientThreadId,
          state: "open",
          createdAt: "2026-08-25T10:00:00.000Z",
          updatedAt: "2026-08-25T10:00:00.000Z",
        },
      });
    }

    if (url.pathname === "/v1/threads/thread_test/messages" && init?.method === "GET") {
      return json({
        threadId: "thread_test",
        messages: [
          {
            id: "message_support",
            threadId: "thread_test",
            direction: "operator_to_customer",
            text: "How can I help?",
            language: "en",
            acceptedAt: "2026-08-25T10:00:00.000Z",
            state: "available",
          },
        ],
        nextCursor: "1",
        hasMore: false,
      });
    }

    if (url.pathname === "/v1/threads/thread_test/messages" && init?.method === "POST") {
      const request = JSON.parse(requestBody(init.body)) as {
        clientMessageId: string;
      };
      return json(
        {
          acceptance: {
            messageId: "message_customer",
            clientMessageId: request.clientMessageId,
            status: "accepted",
          },
        },
        { status: 202 },
      );
    }

    return json(
      {
        error: {
          code: "not_found",
          message: `Unhandled test route: ${url.pathname}`,
          retryable: false,
        },
      },
      { status: 404 },
    );
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("AgentChatWidget", () => {
  it("opens lazily and renders the server transcript", async () => {
    const apiFetch = createApiFetch();
    vi.stubGlobal("fetch", apiFetch);
    const user = userEvent.setup();

    render(
      <AgentChatWidget
        apiBaseUrl="https://support.test"
        context={{ inboxId: "inbox_test", locale: "en" }}
        title="Canto Support"
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open support chat" }));

    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Canto Support");
    expect(await screen.findByText("How can I help?")).toBeVisible();

    const sessionRequest = apiFetch.mock.calls.find(([input]) =>
      requestUrl(input).includes("/v1/client/sessions"),
    );
    expect(sessionRequest).toBeDefined();
    expect(JSON.parse(requestBody(sessionRequest?.[1]?.body))).toMatchObject({
      inboxId: "inbox_test",
    });
  });

  it("sends on Enter, keeps Shift+Enter and IME composition safe", async () => {
    const apiFetch = createApiFetch();
    vi.stubGlobal("fetch", apiFetch);
    const user = userEvent.setup();

    render(
      <AgentChatWidget
        apiBaseUrl="https://support.test"
        context={{ inboxId: "inbox_test", locale: "en" }}
        initiallyOpen
      />,
    );

    const composer = await screen.findByRole("textbox", { name: "Message" });
    await waitFor(() => expect(composer).toBeEnabled());

    await user.type(composer, "composing");
    fireEvent.keyDown(composer, { key: "Enter", isComposing: true });
    expect(composer).toHaveValue("composing");

    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(composer).toHaveValue("composing\n");

    await user.type(composer, "Hello{Enter}");
    expect(composer).toHaveValue("");
    expect(await screen.findByText(/composing\s+Hello/)).toBeVisible();

    const sendRequest = await waitFor(() => {
      const request = apiFetch.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).includes("/v1/threads/thread_test/messages") && init?.method === "POST",
      );
      expect(request).toBeDefined();
      return request;
    });
    const body = JSON.parse(requestBody(sendRequest?.[1]?.body)) as {
      clientMessageId: string;
      text: string;
    };
    expect(body.clientMessageId).toMatch(/^cmsg_/);
    expect(body.text).toBe("composing\nHello");
  });

  it("isolates persisted installation and thread IDs when the host account changes", async () => {
    const apiFetch = createApiFetch();
    vi.stubGlobal("fetch", apiFetch);

    const { rerender } = render(
      <AgentChatWidget
        apiBaseUrl="https://support.test"
        context={{ inboxId: "inbox_test", userId: "user_one" }}
        initiallyOpen
      />,
    );

    await waitFor(() => {
      expect(
        apiFetch.mock.calls.filter(([input]) => requestUrl(input).includes("/v1/client/sessions")),
      ).toHaveLength(1);
    });

    rerender(
      <AgentChatWidget
        apiBaseUrl="https://support.test"
        context={{ inboxId: "inbox_test", userId: "user_two" }}
        initiallyOpen
      />,
    );

    const sessionRequests = await waitFor(() => {
      const requests = apiFetch.mock.calls.filter(([input]) =>
        requestUrl(input).includes("/v1/client/sessions"),
      );
      expect(requests).toHaveLength(2);
      return requests;
    });
    const installationIds = sessionRequests.map(([, init]) => {
      const body = JSON.parse(requestBody(init?.body)) as { installationId: string };
      return body.installationId;
    });

    expect(new Set(installationIds)).toHaveProperty("size", 2);

    const threadRequests = await waitFor(() => {
      const requests = apiFetch.mock.calls.filter(
        ([input, init]) => requestUrl(input).endsWith("/v1/threads") && init?.method === "POST",
      );
      expect(requests).toHaveLength(2);
      return requests;
    });
    const clientThreadIds = threadRequests.map(([, init]) => {
      const body = JSON.parse(requestBody(init?.body)) as { clientThreadId: string };
      return body.clientThreadId;
    });

    expect(new Set(clientThreadIds)).toHaveProperty("size", 2);
  });

  it("ignores an in-flight send result after the host account changes", async () => {
    let resolveSend!: (response: Response) => void;
    const deferredSend = new Promise<Response>((resolve) => {
      resolveSend = resolve;
    });
    const baseFetch = createApiFetch();
    const apiFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(requestUrl(input));
      if (url.pathname.endsWith("/messages") && init?.method === "POST") {
        return deferredSend;
      }
      return baseFetch(input, init);
    });
    vi.stubGlobal("fetch", apiFetch);
    const user = userEvent.setup();

    const { rerender } = render(
      <AgentChatWidget
        apiBaseUrl="https://support.test"
        context={{ inboxId: "inbox_test", userId: "user_one" }}
        initiallyOpen
      />,
    );

    const composer = await screen.findByRole("textbox", { name: "Message" });
    await waitFor(() => expect(composer).toBeEnabled());
    await user.type(composer, "Message from the old account{Enter}");
    expect(await screen.findByText("Message from the old account")).toBeVisible();

    rerender(
      <AgentChatWidget
        apiBaseUrl="https://support.test"
        context={{ inboxId: "inbox_test", userId: "user_two" }}
        initiallyOpen
      />,
    );

    await waitFor(() => {
      expect(
        apiFetch.mock.calls.filter(([input]) => requestUrl(input).includes("/v1/client/sessions")),
      ).toHaveLength(2);
    });
    expect(screen.queryByText("Message from the old account")).not.toBeInTheDocument();

    resolveSend(
      json(
        {
          acceptance: {
            messageId: "message_old_account",
            clientMessageId: "cmsg_old_account",
            status: "accepted",
            message: {
              id: "message_old_account",
              threadId: "thread_test",
              clientMessageId: "cmsg_old_account",
              direction: "customer_to_operator",
              text: "Message from the old account",
              language: "en",
              acceptedAt: "2026-08-25T10:01:00.000Z",
              state: "processing",
            },
          },
        },
        { status: 202 },
      ),
    );

    await waitFor(() => expect(screen.getByText("How can I help?")).toBeVisible());
    expect(screen.queryByText("Message from the old account")).not.toBeInTheDocument();
  });
});
