import type { RespondKitClient, MessageV1, ThreadV1 } from "@respondkit/api-client";

/** Key-free demo transport. Replace the client option with apiBaseUrl/inboxId for a live inbox. */
export function demoClient(): RespondKitClient {
  let thread: ThreadV1 | undefined;
  let email: string | undefined;
  let cursor = 0;
  const messages: MessageV1[] = [];
  const ids = new Set<string>();
  return {
    createSession: async () => ({
      session: {
        id: "session_demo",
        token: "session_demo_token_123456",
        visitorId: "visitor_demo",
        expiresAt: "2099-01-01T00:00:00Z",
      },
    }),
    getContact: async () => (email ? { email } : {}),
    saveContact: async (_token, input) => {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
        throw new Error("Please enter a valid email address.");
      email = input.email;
      return { email };
    },
    listThreads: async () => ({ threads: thread ? [thread] : [] }),
    listThreadStatuses: async () => ({
      threads: thread ? [{ thread, latestReplyCursor: String(cursor) }] : [],
    }),
    getThread: async () => {
      if (!thread) throw new Error("No conversation");
      return { thread };
    },
    createThread: async (_token, input) => {
      thread ??= {
        id: "thread_demo",
        clientThreadId: input.clientThreadId,
        state: "open",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return { thread };
    },
    listMessages: async (_token, threadId) => ({
      threadId,
      messages: [...messages],
      nextCursor: String(cursor),
      hasMore: false,
    }),
    sendMessage: async (_token, threadId, input) => {
      const message: MessageV1 = {
        id: `msg_${input.clientMessageId}`,
        clientMessageId: input.clientMessageId,
        direction: "customer_to_operator",
        threadId,
        text: input.text,
        acceptedAt: new Date().toISOString(),
        state: "available",
      };
      if (!ids.has(input.clientMessageId)) {
        ids.add(input.clientMessageId);
        messages.push(message);
        cursor++;
        setTimeout(() => {
          messages.push({
            id: `reply_${input.clientMessageId}`,
            direction: "operator_to_customer",
            threadId,
            text: "Thanks for reaching out! We can help with that. You can also visit https://respondkit.dev for more information.",
            acceptedAt: new Date().toISOString(),
            state: "available",
          });
          cursor++;
        }, 800);
      }
      return {
        acceptance: {
          messageId: message.id,
          clientMessageId: input.clientMessageId,
          status: "available",
          message,
        },
      };
    },
    markThreadRead: async () => ({ ok: true }),
    logout: async () => ({ ok: true }),
  };
}
