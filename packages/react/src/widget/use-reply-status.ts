import type {
  ClientSessionV1,
  Cursor,
  ListThreadStatusesResponseV1,
  RespondKitClient,
  ThreadV1,
} from "@respondkit/api-client";
import { useCallback, useEffect, useState } from "react";

const STATUS_POLL_INTERVAL_MS = 10_000;
const memory = new Map<string, number>();
const volatileKeys = new Set<string>();

function readCursor(key: string): number {
  try {
    const value = Number(localStorage.getItem(key) ?? 0);
    const persisted = Number.isSafeInteger(value) && value >= 0 ? value : 0;
    return volatileKeys.has(key) ? Math.max(persisted, memory.get(key) ?? 0) : persisted;
  } catch {
    return memory.get(key) ?? 0;
  }
}

/** Read receipts are local to this browser, separate from session credentials. */
export function useReplyStatus({
  client,
  session,
  storageKey,
  enabled,
  onThreads,
}: {
  client: RespondKitClient;
  session: ClientSessionV1 | undefined;
  storageKey: string;
  enabled: boolean;
  onThreads: (threads: ThreadV1[]) => void;
}) {
  const prefix = `${storageKey}:read:${session?.visitorId}:`;
  const [snapshot, setSnapshot] = useState<{
    prefix: string;
    threads: ListThreadStatusesResponseV1["threads"];
  }>();
  const [, setReadVersion] = useState(0);

  const markRead = useCallback(
    (threadId: string, cursor: Cursor) => {
      const key = `${prefix}${threadId}`;
      const value = Number(cursor);
      if (!enabled || !session || value <= readCursor(key)) return;
      memory.set(key, value);
      try {
        localStorage.setItem(key, String(value));
        volatileKeys.delete(key);
      } catch {
        // Quota failures can leave reads working while writes fail.
        volatileKeys.add(key);
      }
      setReadVersion((version) => version + 1);
    },
    [prefix, enabled, session],
  );

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key?.startsWith(prefix)) setReadVersion((version) => version + 1);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [prefix]);

  useEffect(() => {
    setSnapshot(undefined);
    if (!enabled || !session) return;
    const token = session.token;
    const controller = new AbortController();
    let active = true;
    let inFlight = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      if (!active || inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const statuses: ListThreadStatusesResponseV1["threads"] = [];
        let after: string | undefined;
        do {
          const page = await client.listThreadStatuses(token, after, { signal: controller.signal });
          if (!active) return;
          statuses.push(...page.threads);
          if (page.nextCursor === after) break;
          after = page.nextCursor;
        } while (after !== undefined);
        setSnapshot({ prefix, threads: statuses });
        onThreads(statuses.map((status) => status.thread));
      } catch {
        // Keep the last known unread state; the next poll retries transient failures.
      } finally {
        inFlight = false;
        if (active) timeout = setTimeout(poll, STATUS_POLL_INTERVAL_MS);
      }
    }
    function visible() {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timeout);
      void poll();
    }
    document.addEventListener("visibilitychange", visible);
    void poll();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [client, session, enabled, prefix, onThreads]);

  const unreadThreadIds = new Set(
    enabled && snapshot?.prefix === prefix
      ? snapshot.threads
          .filter(
            (status) =>
              Number(status.latestReplyCursor) > readCursor(`${prefix}${status.thread.id}`),
          )
          .map((status) => status.thread.id)
      : [],
  );
  return { unreadThreadIds, markRead };
}
