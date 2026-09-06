import {
  RespondKitClientError,
  createRespondKitClient,
  createClientMessageId,
  type ClientSessionV1,
  type Cursor,
  type MessageAcceptanceV1,
  type MessageV1,
  type ThreadV1,
} from "@respondkit/api-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  legacyAccountIdentity,
  removeLegacyAccountIdentity,
  browserIdentityKey,
  freshBrowserIdentity,
  readBrowserIdentity,
  saveBrowserIdentity,
} from "./browser-identity";

import { useReplyStatus } from "./use-reply-status";

import type {
  RespondKitContext,
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

interface UseRespondKitInput {
  readonly apiBaseUrl: string;
  readonly context: RespondKitContext;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly open: boolean;
  readonly getIdentityToken?: (() => Promise<string | null>) | undefined;
  readonly identityPending?: boolean | undefined;
}

function contextPayload(context: RespondKitContext) {
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
    ...(context.posthogSessionId === undefined
      ? {}
      : { posthogSessionId: context.posthogSessionId }),
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

export function useRespondKit({
  apiBaseUrl,
  context,
  fetch,
  open,
  getIdentityToken,
  identityPending = false,
}: UseRespondKitInput) {
  const client = useMemo(
    () => createRespondKitClient({ baseUrl: apiBaseUrl, fetch }),
    [apiBaseUrl, fetch],
  );
  const storageKey = browserIdentityKey(apiBaseUrl, context.inboxId);
  const identityTokenRef = useRef(getIdentityToken);
  identityTokenRef.current = getIdentityToken;
  const [refresh, setRefresh] = useState(0);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [threads, setThreads] = useState<ThreadV1[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string>();
  const contextKey = JSON.stringify([
    context,
    refresh,
    identityPending,
    storageBlocked,
    Boolean(getIdentityToken),
  ]);
  const contextRef = useRef(context);
  contextRef.current = context;
  const identityEpochRef = useRef(0);
  const initializedClientRef = useRef<typeof client | undefined>(undefined);
  const initializedContextKeyRef = useRef<string | undefined>(undefined);

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
  const hasLoadedTranscriptRef = useRef(false);
  const [loadedTranscript, setLoadedTranscript] = useState<{ threadId: string; cursor: Cursor }>();
  const contextMatches = activeContextKey === contextKey && !identityPending && !storageBlocked;
  const mergeThreads = useCallback((incoming: ThreadV1[]) => {
    setThreads((current) => [
      ...new Map([...current, ...incoming].map((item) => [item.id, item])).values(),
    ]);
  }, []);
  const { unreadThreadIds, markRead } = useReplyStatus({
    client,
    session,
    storageKey,
    enabled: contextMatches && bootstrapState === "ready",
    onThreads: mergeThreads,
  });

  // Acknowledge only a transcript that has committed to the open, visible dialog.
  // The transcript cursor prevents a concurrent status response from hiding a newer reply.
  useEffect(() => {
    function acknowledge() {
      if (
        open &&
        contextMatches &&
        loadedTranscript &&
        loadedTranscript.threadId === thread?.id &&
        document.visibilityState === "visible"
      )
        markRead(loadedTranscript.threadId, loadedTranscript.cursor);
    }
    acknowledge();
    document.addEventListener("visibilitychange", acknowledge);
    return () => document.removeEventListener("visibilitychange", acknowledge);
  }, [open, contextMatches, loadedTranscript, thread?.id, markRead]);

  useEffect(() => {
    setStorageBlocked(false);
  }, [context.userId]);

  useEffect(() => {
    function changed(event: StorageEvent) {
      if (event.key !== storageKey && event.key !== null) return;
      if (event.key === null) {
        setStorageBlocked(true);
        return;
      }
      try {
        const before = event.oldValue
          ? (JSON.parse(event.oldValue) as { installationId?: string; userId?: string })
          : null;
        const after = event.newValue
          ? (JSON.parse(event.newValue) as { installationId?: string; userId?: string })
          : null;
        if (before?.installationId !== after?.installationId || before?.userId !== after?.userId)
          setStorageBlocked(true);
      } catch {
        setStorageBlocked(true);
      }
    }
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [storageKey]);

  useEffect(() => {
    if (identityPending || storageBlocked) return;
    if (
      initializedClientRef.current === client &&
      initializedContextKeyRef.current === contextKey
    ) {
      return;
    }

    identityEpochRef.current += 1;
    initializedClientRef.current = undefined;
    initializedContextKeyRef.current = undefined;
    const abortController = new AbortController();
    let active = true;

    setActiveContextKey(contextKey);
    setBootstrapError(undefined);
    setBootstrapState("resolving_context");
    setPollError(undefined);
    setTranscriptState("idle");
    setSession(undefined);
    setThread(undefined);
    setThreads([]);
    setHistoryCursor(undefined);
    setServerMessages([]);
    setLoadedTranscript(undefined);
    setPendingMessages(new Map<string, PendingMessage>());
    cursorRef.current = INITIAL_CURSOR;
    hasLoadedTranscriptRef.current = false;

    async function bootstrap() {
      try {
        const currentContext = contextRef.current;
        let browser = readBrowserIdentity(storageKey, currentContext.inboxId);
        if (browser.userId !== undefined && browser.userId !== currentContext.userId) {
          if (browser.session) void client.logout(browser.session.token).catch(() => undefined);
          browser = freshBrowserIdentity(currentContext.userId);
        }
        if (currentContext.userId !== undefined) browser.userId = currentContext.userId;
        saveBrowserIdentity(storageKey, browser);
        // Login linking runs even while the launcher is closed. Untouched anonymous pages stay lazy.
        if (!open && currentContext.userId === undefined && !browser.selectedThreadId) return;
        const identityToken =
          currentContext.userId === undefined ? null : await identityTokenRef.current?.();
        if (!active) return;
        if (identityTokenRef.current && currentContext.userId !== undefined && !identityToken) {
          throw new Error("Sign in again to restore your support history.");
        }
        if (identityToken && currentContext.userId !== undefined) {
          const legacy = await legacyAccountIdentity(currentContext.inboxId, currentContext.userId);
          if (!active) return;
          if (legacy) {
            await client.createSession(
              {
                inboxId: currentContext.inboxId,
                installationId: legacy.installationId,
                identityToken,
                context: contextPayload(currentContext),
              },
              { signal: abortController.signal },
            );
            if (!active) return;
            removeLegacyAccountIdentity(legacy.prefix);
          }
        }
        setBootstrapState("creating_session");
        const createSession = () =>
          client.createSession(
            {
              inboxId: currentContext.inboxId,
              installationId: browser.installationId,
              context: contextPayload(currentContext),
              ...(identityToken ? { identityToken } : {}),
            },
            { signal: abortController.signal },
          );
        let sessionResponse;
        try {
          sessionResponse = await createSession();
        } catch (error) {
          // A linked installation cannot become another account or anonymous again.
          if (!(error instanceof RespondKitClientError) || error.code !== "conflict" || !active)
            throw error;
          browser = freshBrowserIdentity(currentContext.userId);
          saveBrowserIdentity(storageKey, browser);
          sessionResponse = await createSession();
        }
        if (!active) return;
        setSession(sessionResponse.session);

        browser.session = sessionResponse.session;
        saveBrowserIdentity(storageKey, browser);
        let available: ThreadV1[] = [];
        let nextCursor: string | undefined;
        // Older anonymous-only hosts keep their existing single-thread API behavior.
        if (identityTokenRef.current) {
          const history = await client.listThreads(sessionResponse.session.token, undefined, {
            signal: abortController.signal,
          });
          available = history.threads;
          nextCursor = history.nextCursor;
        }
        let selected =
          available.find((item) => item.id === browser.selectedThreadId) ??
          available.find((item) => item.clientThreadId === browser.clientThreadId);
        // The active conversation may be outside the first page of a large account history.
        if (!selected && browser.selectedThreadId) {
          try {
            selected = (
              await client.getThread(sessionResponse.session.token, browser.selectedThreadId, {
                signal: abortController.signal,
              })
            ).thread;
            available = [selected, ...available];
          } catch (error) {
            if (!(error instanceof RespondKitClientError) || error.code !== "not_found")
              throw error;
          }
        }
        selected ??= [...available].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        if (selected === undefined && open) {
          setBootstrapState("creating_thread");
          selected = (
            await client.createThread(
              sessionResponse.session.token,
              { clientThreadId: browser.clientThreadId },
              { signal: abortController.signal },
            )
          ).thread;
          available = [selected, ...available];
        }
        if (!active) return;
        if (selected) browser.selectedThreadId = selected.id;
        saveBrowserIdentity(storageKey, browser);
        setThreads(available);
        setHistoryCursor(nextCursor);
        cursorRef.current = INITIAL_CURSOR;
        initializedClientRef.current = client;
        initializedContextKeyRef.current = selected === undefined ? undefined : contextKey;
        setServerMessages([]);
        setThread(selected);
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
  }, [client, contextKey, open, identityPending, storageBlocked, storageKey]);

  useEffect(() => {
    if (!session || identityPending || storageBlocked) return;
    let active = true;
    const controller = new AbortController();
    const epoch = identityEpochRef.current;
    // Browsers clamp delays above a signed 32-bit integer to about 1 ms.
    const delay = Math.min(
      2_147_000_000,
      Math.max(1000, new Date(session.expiresAt).getTime() - Date.now() - 30_000),
    );
    const timeout = setTimeout(async () => {
      try {
        const current = contextRef.current;
        const identityToken =
          current.userId === undefined ? null : await identityTokenRef.current?.();
        if (!active || epoch !== identityEpochRef.current) return;
        if (identityTokenRef.current && current.userId !== undefined && !identityToken)
          throw new Error("Sign in again to restore your support history.");
        const browser = readBrowserIdentity(storageKey, current.inboxId);
        const response = await client.createSession(
          {
            inboxId: current.inboxId,
            installationId: browser.installationId,
            context: contextPayload(current),
            ...(identityToken ? { identityToken } : {}),
          },
          { signal: controller.signal },
        );
        if (!active || epoch !== identityEpochRef.current) return;
        browser.session = response.session;
        saveBrowserIdentity(storageKey, browser);
        setSession(response.session);
      } catch {
        if (!active || epoch !== identityEpochRef.current) return;
        setSession(undefined);
        setServerMessages([]);
        setBootstrapState("recoverable_error");
        setBootstrapError("Your support session expired. Reconnect to continue.");
      }
    }, delay);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [client, session, thread, storageKey, identityPending, storageBlocked]);

  function selectThread(id: string) {
    const selected = threads.find((item) => item.id === id);
    if (!selected || selected.id === thread?.id) return;
    identityEpochRef.current += 1;
    cursorRef.current = INITIAL_CURSOR;
    hasLoadedTranscriptRef.current = false;
    setServerMessages([]);
    setLoadedTranscript(undefined);
    setPendingMessages(new Map());
    setTranscriptState("loading");
    setThread(selected);
    const browser = readBrowserIdentity(storageKey, context.inboxId);
    browser.selectedThreadId = selected.id;
    saveBrowserIdentity(storageKey, browser);
  }

  async function loadMoreThreads() {
    if (!session || !historyCursor) return;
    const epoch = identityEpochRef.current;
    try {
      const page = await client.listThreads(session.token, historyCursor);
      if (epoch !== identityEpochRef.current) return;
      setThreads((items) => [
        ...new Map([...items, ...page.threads].map((item) => [item.id, item])).values(),
      ]);
      setHistoryCursor(page.nextCursor);
    } catch {
      if (epoch === identityEpochRef.current)
        setPollError("Conversation history could not be loaded. Try More again.");
    }
  }

  const mergeMessages = useCallback((incoming: readonly MessageV1[]) => {
    if (incoming.length === 0) return;
    setServerMessages((current) => {
      const indexed = new Map(current.map((message) => [message.id, message]));
      for (const message of incoming) indexed.set(message.id, message);
      return sortServerMessages(indexed.values());
    });
  }, []);

  useEffect(() => {
    if (
      !open ||
      identityPending ||
      storageBlocked ||
      activeContextKey !== contextKey ||
      session === undefined ||
      thread === undefined
    )
      return;

    const activeSession = session;
    const activeThread = thread;
    const abortController = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    let inFlight = false;

    async function poll() {
      if (!active || inFlight) return;
      if (document.visibilityState === "hidden") {
        timeout = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      inFlight = true;
      // An empty transcript can load successfully without advancing the cursor.
      if (!hasLoadedTranscriptRef.current) setTranscriptState("loading");

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
          if (!active || abortController.signal.aborted) return;
          mergeMessages(response.messages);
          cursorRef.current = response.nextCursor;
          hasMore = response.hasMore && response.nextCursor !== previousCursor;
        }
        setLoadedTranscript({ threadId: activeThread.id, cursor: cursorRef.current });
        hasLoadedTranscriptRef.current = true;
        setPollError(undefined);
        setTranscriptState("ready");
      } catch (error) {
        if (abortController.signal.aborted || !active) return;
        setPollError(error instanceof Error ? error.message : "New messages could not be loaded.");
        setTranscriptState("stale");
      } finally {
        inFlight = false;
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
  }, [
    client,
    mergeMessages,
    open,
    session,
    thread,
    identityPending,
    storageBlocked,
    activeContextKey,
    contextKey,
  ]);

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
          error instanceof RespondKitClientError && error.code === "acceptance_unknown";
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

  return {
    unreadThreadIds,
    threads: contextMatches ? threads : [],
    selectedThreadId: contextMatches ? thread?.id : undefined,
    reconnect: () => (storageBlocked ? window.location.reload() : setRefresh((value) => value + 1)),
    selectThread,
    loadMoreThreads,
    hasMoreThreads: contextMatches && historyCursor !== undefined,
    bootstrapError: storageBlocked
      ? "Support identity changed in another tab. Reconnect to reload your account."
      : contextMatches
        ? bootstrapError
        : undefined,
    bootstrapState: storageBlocked
      ? "recoverable_error"
      : contextMatches
        ? bootstrapState
        : "resolving_context",
    messages: contextMatches ? displayMessages(serverMessages, pendingMessages) : [],
    pollError: contextMatches ? pollError : undefined,
    retryMessage,
    sendMessage,
    transcriptState: contextMatches ? transcriptState : "idle",
  };
}
