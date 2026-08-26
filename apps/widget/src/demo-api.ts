interface DemoMessage {
  readonly id: string;
  readonly threadId: string;
  readonly clientMessageId?: string | undefined;
  readonly direction: "customer_to_operator" | "operator_to_customer";
  readonly text: string;
  readonly language: string;
  readonly acceptedAt: string;
  readonly state: "processing" | "available" | "failed";
}

const baseTime = Date.now() - 120_000;
const messages: DemoMessage[] = [
  {
    id: "message_demo_customer",
    threadId: "thread_demo",
    clientMessageId: "cmsg_demo_customer",
    direction: "customer_to_operator",
    text: "My transcription stopped at 99%.",
    language: "en",
    acceptedAt: new Date(baseTime).toISOString(),
    state: "available",
  },
  {
    id: "message_demo_support",
    threadId: "thread_demo",
    direction: "operator_to_customer",
    text: "Thanks — I can help. Which browser are you using?",
    language: "en",
    acceptedAt: new Date(baseTime + 60_000).toISOString(),
    state: "available",
  },
];

function json(body: unknown, init?: ResponseInit) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
      ...init,
    }),
  );
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

export const demoApiFetch: typeof fetch = async (input, init) => {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const url = new URL(requestUrl(input));

  if (url.pathname === "/v1/client/sessions") {
    return json({
      session: {
        id: "session_demo",
        token: "session_demo_token_12345",
        visitorId: "visitor_demo",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
  }

  if (url.pathname === "/v1/threads") {
    if (typeof init?.body !== "string") throw new TypeError("Expected a JSON body");
    const request = JSON.parse(init.body) as { clientThreadId: string };
    return json({
      thread: {
        id: "thread_demo",
        clientThreadId: request.clientThreadId,
        state: "open",
        createdAt: new Date(baseTime).toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }

  if (url.pathname === "/v1/threads/thread_demo/messages" && init?.method === "GET") {
    const after = Number(url.searchParams.get("after") ?? "0");
    return json({
      threadId: "thread_demo",
      messages: messages.slice(after),
      nextCursor: String(messages.length),
      hasMore: false,
    });
  }

  if (url.pathname === "/v1/threads/thread_demo/messages" && init?.method === "POST") {
    if (typeof init.body !== "string") throw new TypeError("Expected a JSON body");
    const request = JSON.parse(init.body) as {
      clientMessageId: string;
      text: string;
    };
    const message: DemoMessage = {
      id: `message_${request.clientMessageId}`,
      threadId: "thread_demo",
      clientMessageId: request.clientMessageId,
      direction: "customer_to_operator",
      text: request.text,
      language: "en",
      acceptedAt: new Date().toISOString(),
      state: "available",
    };
    const existing = messages.find(
      (candidate) => candidate.clientMessageId === request.clientMessageId,
    );
    if (existing === undefined) messages.push(message);

    return json(
      {
        acceptance: {
          messageId: existing?.id ?? message.id,
          clientMessageId: request.clientMessageId,
          status: "available",
          message: existing ?? message,
        },
      },
      { status: 202 },
    );
  }

  return json(
    {
      error: {
        code: "not_found",
        message: "Demo route not found",
        retryable: false,
      },
    },
    { status: 404 },
  );
};
