import {
  AgentChatClientError,
  createAgentChatClient,
  createClientMessageId,
  createClientThreadId,
  createInstallationId,
  type ClientSessionV1,
  type Cursor,
  type MessageAcceptanceV1,
  type MessageV1,
  type ThreadV1,
} from "@agent-chat/api-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentChatContext,
  BootstrapState,
  DisplayMessage,
  LocalDeliveryState,
  TranscriptState,
} from "./types";

const POLL_INTERVAL_MS = 2_000;
const INITIAL_CURSOR = "0" as Cursor;

interface PendingMessage {
  readonly clientMessageId: string;
  readonly text: string;
  readonly acceptedAt: string;
  readonly delivery: LocalDeliveryState;
}

interface UseAgentChatInput {
  readonly apiBaseUrl: string;
  readonly context: AgentChatContext;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly open: boolean;
}

function storageValue(key: string, create: () => string) {
  try {
    const existing = window.localStorage.getItem(key);
    if (existing !== null) return existing;

    const value = create();
    window.localStorage.setItem(key, value);
    return value;
  } catch {
    return create();
  }
}

async function identityStorageScope(userId: string | undefined) {
  if (userId === undefined) return "anonymous";
  if (globalThis.crypto?.subtle === undefined) {
    throw new Error("Support chat requires a secure browser context.");
  }

  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  return `user-${[...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function contextPayload(context: AgentChatContext) {
  const metadata = {
    ...context.metadata,
    ...(context.path === undefined ? {} : { pagePath: context.path }),
  };

  return {
    ...(context.userId === undefined ? {} : { userId: context.userId }),
    ...(context.email === undefined ? {} : { email: context.email }),
    ...(context.posthogDistinctId === undefined
      ? {}
      : { posthogDistinctId: context.posthogDistinctId }),
    ...(context.locale === undefined ? {} : { locale: context.locale }),
    ...(context.timezone === undefined ? {} : { timezone: context.timezone }),
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
}

function sortServerMessages(messages: Iterable<MessageV1>) {
  return [...messages].toSorted((left, right) => {
    const accepted = left.acceptedAt.localeCompare(right.acceptedAt);
    return accepted === 0 ? left.id.localeCompare(right.id) : accepted;
  });
}

function deliveryFromAcceptance(acceptance: MessageAcceptanceV1): LocalDeliveryState {
  switch (acceptance.status) {
    case "acceptance_unknown":
      return "acceptance_unknown";
    case "failed":
      return "failed_retryable";
    default:
      return "accepted";
  }
}

function displayMessages(
  serverMessages: readonly MessageV1[],
  pendingMessages: ReadonlyMap<string, PendingMessage>,
): DisplayMessage[] {
  const serverClientIds = new Set(
    serverMessages.flatMap((message) =>
      message.clientMessageId === undefined ? [] : [message.clientMessageId],
    ),
  );

  const combined: DisplayMessage[] = serverMessages.map((message) => ({
    key: message.id,
    id: message.id,
    ...(message.clientMessageId === undefined ? {} : { clientMessageId: message.clientMessageId }),
    direction: message.direction,
    text: message.text,
    acceptedAt: message.acceptedAt,
    state: message.state,
  }));

  for (const pending of pendingMessages.values()) {
    if (serverClientIds.has(pending.clientMessageId)) continue;
    combined.push({
      key: pending.clientMessageId,
      clientMessageId: pending.clientMessageId,
      direction: "customer_to_operator",
      text: pending.text,
      acceptedAt: pending.acceptedAt,
      state: "processing",
      localDelivery: pending.delivery,
    });
  }

  return combined.toSorted((left, right) => {
    const accepted = left.acceptedAt.localeCompare(right.acceptedAt);
    return accepted === 0 ? left.key.localeCompare(right.key) : accepted;
  });
}

export function useAgentChat({ apiBaseUrl, context, fetch, open }: UseAgentChatInput) {
  const client = useMemo(
    () => createAgentChatClient({ baseUrl: apiBaseUrl, fetch }),
    [apiBaseUrl, fetch],
  );
  const contextKey = JSON.stringify(context);
  const contextRef = useRef(context);
  contextRef.current = context;
  const identityEpochRef = useRef(0);

  const [activeContextKey, setActiveContextKey] = useState(contextKey);
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>("idle");
  const [transcriptState, setTranscriptState] = useState<TranscriptState>("idle");
  const [bootstrapError, setBootstrapError] = useState<string>();
  const [pollError, setPollError] = useState<string>();
  const [session, setSession] = useState<ClientSessionV1>();
  const [thread, setThread] = useState<ThreadV1>();
  const [serverMessages, setServerMessages] = useState<MessageV1[]>([]);
  const [pendingMessages, setPendingMessages] = useState<ReadonlyMap<string, PendingMessage>>(
    () => new Map(),
  );
  const cursorRef = useRef<Cursor>(INITIAL_CURSOR);

  useEffect(() => {
    if (!open) return;

    identityEpochRef.current += 1;
    const abortController = new AbortController();
    let active = true;

    setActiveContextKey(contextKey);
    setBootstrapError(undefined);
    setBootstrapState("resolving_context");
    setPollError(undefined);
    setTranscriptState("idle");
    setSession(undefined);
    setThread(undefined);
    setServerMessages([]);
    setPendingMessages(new Map<string, PendingMessage>());
    cursorRef.current = INITIAL_CURSOR;

    async function bootstrap() {
      try {
        const currentContext = contextRef.current;
        const identityScope = await identityStorageScope(currentContext.userId);
        if (!active) return;
        const storagePrefix = `agent-chat:${currentContext.inboxId}:${identityScope}`;
        const installationId = storageValue(
          `${storagePrefix}:installation-id`,
          createInstallationId,
        );
        const clientThreadId = storageValue(`${storagePrefix}:thread-id`, createClientThreadId);

        setBootstrapState("creating_session");
        const sessionResponse = await client.createSession(
          {
            inboxId: currentContext.inboxId,
            installationId,
            context: contextPayload(currentContext),
          },
          { signal: abortController.signal },
        );
        if (!active) return;
        setSession(sessionResponse.session);

        setBootstrapState("creating_thread");
        const threadResponse = await client.createThread(
          sessionResponse.session.token,
          { clientThreadId },
          { signal: abortController.signal },
        );
        if (!active) return;

        cursorRef.current = INITIAL_CURSOR;
        setServerMessages([]);
        setThread(threadResponse.thread);
        setBootstrapState("ready");
      } catch (error) {
        if (abortController.signal.aborted || !active) return;
        setBootstrapError(
          error instanceof Error ? error.message : "Support chat could not be started.",
        );
        setBootstrapState("recoverable_error");
      }
    }

    void bootstrap();
    return () => {
      active = false;
      abortController.abort();
    };
  }, [client, contextKey, open]);

  const mergeMessages = useCallback((incoming: readonly MessageV1[]) => {
    if (incoming.length === 0) return;
    setServerMessages((current) => {
      const indexed = new Map(current.map((message) => [message.id, message]));
      for (const message of incoming) indexed.set(message.id, message);
      return sortServerMessages(indexed.values());
    });
  }, []);

  useEffect(() => {
    if (!open || session === undefined || thread === undefined) return;

    const activeSession = session;
    const activeThread = thread;
    const abortController = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let active = true;

    async function poll() {
      if (!active || document.visibilityState === "hidden") {
        timeout = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      if (cursorRef.current === INITIAL_CURSOR) setTranscriptState("loading");

      try {
        let hasMore = true;
        while (hasMore && active) {
          const previousCursor = cursorRef.current;
          const response = await client.listMessages(
            activeSession.token,
            activeThread.id,
            { after: previousCursor, limit: 100 },
            { signal: abortController.signal },
          );
          mergeMessages(response.messages);
          cursorRef.current = response.nextCursor;
          hasMore = response.hasMore && response.nextCursor !== previousCursor;
        }
        setPollError(undefined);
        setTranscriptState("ready");
      } catch (error) {
        if (abortController.signal.aborted || !active) return;
        setPollError(error instanceof Error ? error.message : "New messages could not be loaded.");
        setTranscriptState("stale");
      } finally {
        if (active) timeout = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        if (timeout !== undefined) clearTimeout(timeout);
        void poll();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void poll();

    return () => {
      active = false;
      abortController.abort();
      if (timeout !== undefined) clearTimeout(timeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [client, mergeMessages, open, session, thread]);

  const submitPending = useCallback(
    async (pending: PendingMessage) => {
      if (session === undefined || thread === undefined) return;
      const identityEpoch = identityEpochRef.current;

      setServerMessages((current) =>
        current.filter(
          (message) =>
            message.clientMessageId !== pending.clientMessageId || message.state !== "failed",
        ),
      );
      setPendingMessages((current) => {
        const next = new Map(current);
        next.set(pending.clientMessageId, {
          ...pending,
          delivery: "optimistic",
        });
        return next;
      });

      try {
        const response = await client.sendMessage(session.token, thread.id, {
          clientMessageId: pending.clientMessageId,
          text: pending.text,
        });
        if (identityEpochRef.current !== identityEpoch) return;
        if (response.acceptance.message !== undefined) {
          mergeMessages([response.acceptance.message]);
        }
        setPendingMessages((current) => {
          const next = new Map(current);
          next.set(pending.clientMessageId, {
            ...pending,
            delivery: deliveryFromAcceptance(response.acceptance),
          });
          return next;
        });
      } catch (error) {
        if (identityEpochRef.current !== identityEpoch) return;
        const acceptanceUnknown =
          error instanceof AgentChatClientError && error.code === "acceptance_unknown";
        setPendingMessages((current) => {
          const next = new Map(current);
          next.set(pending.clientMessageId, {
            ...pending,
            delivery: acceptanceUnknown ? "acceptance_unknown" : "failed_retryable",
          });
          return next;
        });
      }
    },
    [client, mergeMessages, session, thread],
  );

  const sendMessage = useCallback(
    (text: string) => {
      const normalizedText = text.trim();
      if (normalizedText.length === 0 || bootstrapState !== "ready") return;

      void submitPending({
        clientMessageId: createClientMessageId(),
        text: normalizedText,
        acceptedAt: new Date().toISOString(),
        delivery: "optimistic",
      });
    },
    [bootstrapState, submitPending],
  );

  const retryMessage = useCallback(
    (clientMessageId: string) => {
      const pending =
        pendingMessages.get(clientMessageId) ??
        (() => {
          const failed = serverMessages.find(
            (message) =>
              message.clientMessageId === clientMessageId &&
              message.direction === "customer_to_operator" &&
              message.state === "failed",
          );
          if (failed === undefined) return undefined;
          return {
            clientMessageId,
            text: failed.text,
            acceptedAt: failed.acceptedAt,
            delivery: "failed_retryable" as const,
          };
        })();
      if (pending !== undefined) void submitPending(pending);
    },
    [pendingMessages, serverMessages, submitPending],
  );

  const contextMatches = activeContextKey === contextKey;

  return {
    bootstrapError: contextMatches ? bootstrapError : undefined,
    bootstrapState: contextMatches ? bootstrapState : "resolving_context",
    messages: contextMatches ? displayMessages(serverMessages, pendingMessages) : [],
    pollError: contextMatches ? pollError : undefined,
    retryMessage,
    sendMessage,
    transcriptState: contextMatches ? transcriptState : "idle",
  };
}
