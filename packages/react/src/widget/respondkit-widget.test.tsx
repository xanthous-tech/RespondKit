import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { RespondKitWidget } from "./respondkit-widget";
import { respondKitAccentPalette } from "./theme";

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

    if (url.pathname === "/v1/threads/thread_test/read-receipts" && init?.method === "POST") {
      const request = JSON.parse(requestBody(init.body)) as { messageIds: string[] };
      return json({ acknowledgedMessageIds: request.messageIds, pendingMessageIds: [] });
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

function createFailedMessageApiFetch() {
  const baseFetch = createApiFetch();
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(requestUrl(input));
    if (url.pathname === "/v1/threads/thread_test/messages" && init?.method === "GET") {
      return json({
        threadId: "thread_test",
        messages: [
          {
            id: "message_failed",
            threadId: "thread_test",
            clientMessageId: "cmsg_failed",
            direction: "customer_to_operator",
            text: "Please retry this message",
            language: "en",
            acceptedAt: "2026-08-25T10:00:00.000Z",
            state: "failed",
          },
        ],
        nextCursor: "1",
        hasMore: false,
      });
    }
    if (url.pathname === "/v1/threads/thread_test/messages" && init?.method === "POST") {
      const request = JSON.parse(requestBody(init.body)) as {
        clientMessageId: string;
        text: string;
      };
      return json(
        {
          acceptance: {
            messageId: "message_failed",
            clientMessageId: request.clientMessageId,
            status: "processing",
            message: {
              id: "message_failed",
              threadId: "thread_test",
              clientMessageId: request.clientMessageId,
              direction: "customer_to_operator",
              text: request.text,
              language: "en",
              acceptedAt: "2026-08-25T10:00:00.000Z",
              state: "processing",
            },
          },
        },
        { status: 202 },
      );
    }
    return baseFetch(input, init);
  });
}

function createAmbiguousAcceptanceApiFetch() {
  const baseFetch = createApiFetch();
  let sendCount = 0;

  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(requestUrl(input));
    if (url.pathname === "/v1/threads/thread_test/messages" && init?.method === "POST") {
      sendCount += 1;
      const request = JSON.parse(requestBody(init.body)) as {
        clientMessageId: string;
      };
      return json(
        {
          acceptance: {
            messageId: "message_ambiguous",
            clientMessageId: request.clientMessageId,
            status: sendCount <= 3 ? "acceptance_unknown" : "accepted",
          },
        },
        { status: sendCount <= 3 ? 200 : 202 },
      );
    }
    return baseFetch(input, init);
  });
}

function createDelayedEmptyTranscriptApiFetch() {
  const baseFetch = createApiFetch();
  let resolveTranscript!: (response: Response) => void;
  const transcriptResponse = new Promise<Response>((resolve) => {
    resolveTranscript = resolve;
  });

  const apiFetch = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(requestUrl(input));
    if (url.pathname === "/v1/threads/thread_test/messages" && init?.method === "GET") {
      return transcriptResponse;
    }
    return baseFetch(input, init);
  });

  return {
    apiFetch,
    resolveTranscript: () => {
      resolveTranscript(
        json({
          threadId: "thread_test",
          messages: [],
          nextCursor: "0",
          hasMore: false,
        }),
      );
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("RespondKitWidget", () => {
  it("applies the selected accent theme without rendering a translation notice", async () => {
    const apiFetch = createApiFetch();
    vi.stubGlobal("fetch", apiFetch);

    const { container } = render(
      <RespondKitWidget
        accentColor="lime"
        apiBaseUrl="https://support.test"
        context={{ inboxId: "inbox_test", locale: "en" }}
        initiallyOpen
      />,
    );

    const root = container.querySelector<HTMLElement>("[data-accent-color='lime']");
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute("data-accent-color", "lime");
    expect(root?.style.getPropertyValue("--respondkit-primary")).toBe(respondKitAccentPalette.lime);
    expect(root?.style.getPropertyValue("--respondkit-ring")).toBe(respondKitAccentPalette.lime);
    expect(
      screen.queryByText("Messages are translated for our support team."),
    ).not.toBeInTheDocument();

    expect(await screen.findByText("How can I help?")).toBeVisible();
    expect(
      screen.queryByText("Messages are translated for our support team."),
    ).not.toBeInTheDocument();
  });

  it("uses compact message tails and matching 44px composer controls", async () => {
    const apiFetch = createApiFetch();
    vi.stubGlobal("fetch", apiFetch);
    const user = userEvent.setup();

    render(
      <RespondKitWidget
        apiBaseUrl="https://support.test"
        context={{ inboxId: "inbox_test", locale: "en" }}
        initiallyOpen
      />,
    );

    const operatorBubble = await screen.findByText("How can I help?");
    expect(operatorBubble).toHaveClass("ac:rounded-bl-[4px]");
    expect(operatorBubble).not.toHaveClass("ac:rounded-bl-sm");

    const composer = screen.getByRole("textbox", { name: "Message" });
    const sendButton = screen.getByRole("button", { name: "Send message" });
    expect(composer).toHaveClass("ac:min-h-11");
    expect(sendButton).toHaveClass("ac:size-11");

    await waitFor(() => expect(composer).toBeEnabled());
    await user.type(composer, "Customer message{Enter}");

    const customerBubble = await screen.findByText("Customer message");
    expect(customerBubble).toHaveClass("ac:rounded-br-[4px]");
    expect(customerBubble).not.toHaveClass("ac:rounded-br-sm");
  });

  it("toggles from the floating launcher and focuses the heading without opening a tooltip", async () => {
    const apiFetch = createApiFetch();
    vi.stubGlobal("fetch", apiFetch);

    render(
      <RespondKitWidget
        apiBaseUrl="https://support.test"
        context={{ inboxId: "inbox_test", locale: "en" }}
        title="Example Support"
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const openLauncher = screen.getByRole("button", {
      name: "Open support chat",
      expanded: false,
    });
    fireEvent.click(openLauncher);

    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Example Support");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Example Support" })).toHaveFocus(),
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(await screen.findByText("How can I help?")).toBeVisible();

    const sessionRequest = apiFetch.mock.calls.find(([input]) =>
      requestUrl(input).includes("/v1/client/sessions"),
    );
    expect(sessionRequest).toBeDefined();
    expect(JSON.parse(requestBody(sessionRequest?.[1]?.body))).toMatchObject({
      inboxId: "inbox_test",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Close support chat",
        expanded: true,
      }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Open support chat",
        expanded: false,
      }),
    ).toBeVisible();
  });

  it("polls more slowly while collapsed and acknowledges an unread reply when opened", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const apiFetch = createApiFetch();
    vi.stubGlobal("fetch", apiFetch);

    render(
      <RespondKitWidget
        apiBaseUrl="https://support.test"
        context={{ inboxId: "inbox_test", locale: "en" }}
      />,
    );

    const messagePolls = () =>
      apiFetch.mock.calls.filter(
        ([input, init]) =>
          new URL(requestUrl(input)).pathname === "/v1/threads/thread_test/messages" &&
          init?.method === "GET",
      );
    await waitFor(() => expect(messagePolls()).toHaveLength(1));
    expect(await screen.findByRole("status", { name: "Unread support reply" })).toBeVisible();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(messagePolls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(8_000);
    await waitFor(() => expect(messagePolls()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Open support chat" }));
    expect(screen.queryByRole("status", { name: "Unread support reply" })).not.toBeInTheDocument();

    const receiptRequest = await waitFor(() => {
      const request = apiFetch.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith("/v1/threads/thread_test/read-receipts") &&
          init?.method === "POST",
      );
      expect(request).toBeDefined();
      return request;
    });
    expect(JSON.parse(requestBody(receiptRequest?.[1]?.body))).toEqual({
      messageIds: ["message_support"],
    });
  });

  it("keeps the loading skeleton visible until an empty initial transcript resolves", async () => {
    const { apiFetch, resolveTranscript } = createDelayedEmptyTranscriptApiFetch();
    vi.stubGlobal("fetch", apiFetch);

    render(
      <RespondKitWidget
        apiBaseUrl="https://support.test"
        context={{ inboxId: "inbox_test", locale: "en" }}
        initiallyOpen
      />,
    );

    expect(screen.getByLabelText("Loading messages")).toBeVisible();
    expect(screen.queryByText("How can we help?")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(
        apiFetch.mock.calls.filter(
          ([input, init]) =>
            requestUrl(input).includes("/v1/threads/thread_test/messages") &&
            init?.method === "GET",
        ),
      ).toHaveLength(1);
    });
    expect(screen.getByLabelText("Loading messages")).toBeVisible();
    expect(screen.queryByText("How can we help?")).not.toBeInTheDocument();

    resolveTranscript();

    expect(await screen.findByText("How can we help?")).toBeVisible();
    expect(screen.queryByLabelText("Loading messages")).not.toBeInTheDocument();
  });

  it("retains a successful transcript across launcher close and reopen", async () => {
    const apiFetch = createApiFetch();
    vi.stubGlobal("fetch", apiFetch);

    render(
      <RespondKitWidget
        apiBaseUrl="https://support.test"
        context={{ inboxId: "inbox_test", locale: "en" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open support chat" }));
    expect(await screen.findByText("How can I help?")).toBeVisible();

    const sessionRequests = () =>
      apiFetch.mock.calls.filter(([input]) => requestUrl(input).includes("/v1/client/sessions"));
    const threadRequests = () =>
      apiFetch.mock.calls.filter(
        ([input, init]) => requestUrl(input).endsWith("/v1/threads") && init?.method === "POST",
      );
    expect(sessionRequests()).toHaveLength(1);
    expect(threadRequests()).toHaveLength(1);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Close support chat",
        expanded: true,
      }),
    );
    expect(screen.queryByText("How can I help?")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open support chat" }));

    expect(await screen.findByText("How can I help?")).toBeVisible();
    expect(sessionRequests()).toHaveLength(1);
    expect(threadRequests()).toHaveLength(1);
  });

  it("sends on Enter, keeps Shift+Enter and IME composition safe", async () => {
    const apiFetch = createApiFetch();
    vi.stubGlobal("fetch", apiFetch);
    const user = userEvent.setup();

    render(
      <RespondKitWidget
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
    expect(await screen.findByText("Sent")).toBeVisible();
  });

  it("shows and retries a terminal server failure after a fresh load", async () => {
    const apiFetch = createFailedMessageApiFetch();
    vi.stubGlobal("fetch", apiFetch);
    const user = userEvent.setup();

    render(
      <RespondKitWidget
        apiBaseUrl="https://support.test"
        context={{ inboxId: "inbox_test", locale: "en" }}
        initiallyOpen
      />,
    );

    expect(await screen.findByText("Failed")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Try again/ }));

    const retryRequest = await waitFor(() => {
      const request = apiFetch.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).includes("/v1/threads/thread_test/messages") && init?.method === "POST",
      );
      expect(request).toBeDefined();
      return request;
    });
    expect(JSON.parse(requestBody(retryRequest?.[1]?.body))).toEqual({
      clientMessageId: "cmsg_failed",
      text: "Please retry this message",
    });
    expect(await screen.findByText("Sent")).toBeVisible();
  });

  it("retries ambiguous acceptance with the original immutable message ID", async () => {
    const apiFetch = createAmbiguousAcceptanceApiFetch();
    vi.stubGlobal("fetch", apiFetch);
    const user = userEvent.setup();

    render(
      <RespondKitWidget
        apiBaseUrl="https://support.test"
        context={{ inboxId: "inbox_test", locale: "en" }}
        initiallyOpen
      />,
    );

    const composer = await screen.findByRole("textbox", { name: "Message" });
    await waitFor(() => expect(composer).toBeEnabled());
    await user.type(composer, "Keep the same identity{Enter}");

    expect(await screen.findByText("Confirming…")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Try again/ }));

    const sends = await waitFor(() => {
      const requests = apiFetch.mock.calls.filter(
        ([input, init]) =>
          requestUrl(input).includes("/v1/threads/thread_test/messages") && init?.method === "POST",
      );
      expect(requests).toHaveLength(4);
      return requests;
    });
    const messageIds = sends.map(([, init]) => {
      const body = JSON.parse(requestBody(init?.body)) as { clientMessageId: string };
      return body.clientMessageId;
    });

    expect(new Set(messageIds)).toHaveProperty("size", 1);
    expect(await screen.findByText("Sent")).toBeVisible();
  });

  it("isolates persisted installation and thread IDs when the host account changes", async () => {
    const apiFetch = createApiFetch();
    vi.stubGlobal("fetch", apiFetch);

    const { rerender } = render(
      <RespondKitWidget
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
      <RespondKitWidget
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
      <RespondKitWidget
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
      <RespondKitWidget
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
