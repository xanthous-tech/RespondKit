import {
  createClientThreadId,
  createInstallationId,
  type ClientSessionV1,
} from "@respondkit/api-client";

export interface BrowserIdentity {
  installationId: string;
  clientThreadId: string;
  userId?: string;
  selectedThreadId?: string;
  session?: ClientSessionV1;
}
const memory = new Map<string, BrowserIdentity>();

export function browserIdentityKey(apiBaseUrl: string, inboxId: string) {
  return `respondkit:v2:${encodeURIComponent(apiBaseUrl.replace(/\/+$/, ""))}:${inboxId}`;
}

export function saveBrowserIdentity(key: string, value: BrowserIdentity) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Keep this page usable when persistence is blocked. */
  }
}

export function freshBrowserIdentity(userId: string | undefined): BrowserIdentity {
  return {
    installationId: createInstallationId(),
    clientThreadId: createClientThreadId(),
    ...(userId === undefined ? {} : { userId }),
  };
}

export function readBrowserIdentity(key: string, inboxId: string): BrowserIdentity {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const value = JSON.parse(raw) as BrowserIdentity;
      if (
        typeof value.installationId === "string" &&
        typeof value.clientThreadId === "string" &&
        (value.userId === undefined || typeof value.userId === "string")
      )
        return value;
    }
    // Preserve pre-upgrade anonymous conversations. Never infer an account from an old userId key.
    const installationId = localStorage.getItem(`respondkit:${inboxId}:anonymous:installation-id`);
    const clientThreadId = localStorage.getItem(`respondkit:${inboxId}:anonymous:thread-id`);
    const value =
      installationId && clientThreadId
        ? { installationId, clientThreadId }
        : freshBrowserIdentity(undefined);
    saveBrowserIdentity(key, value);
    localStorage.removeItem(`respondkit:${inboxId}:anonymous:installation-id`);
    localStorage.removeItem(`respondkit:${inboxId}:anonymous:thread-id`);
    return value;
  } catch {
    return memory.get(key) ?? freshBrowserIdentity(undefined);
  }
}

/** Only call after the host has supplied an account assertion; raw user IDs cannot claim history. */
export async function legacyAccountIdentity(inboxId: string, userId: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId)),
  );
  const scope = `user-${Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const prefix = `respondkit:${inboxId}:${scope}`;
  try {
    const installationId = localStorage.getItem(`${prefix}:installation-id`);
    return installationId ? { installationId, prefix } : null;
  } catch {
    return null;
  }
}

export function removeLegacyAccountIdentity(prefix: string) {
  try {
    localStorage.removeItem(`${prefix}:installation-id`);
    localStorage.removeItem(`${prefix}:thread-id`);
  } catch {
    /* A repeated import is safe: the server links idempotently. */
  }
}
