import { z } from "zod";

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function opaqueIdSchema(label: string, maximumLength = 128) {
  return z
    .string()
    .min(1, `${label} is required`)
    .max(maximumLength, `${label} is too long`)
    .regex(OPAQUE_ID_PATTERN, `${label} is malformed`);
}

export const InstallationIdSchema = opaqueIdSchema("installation ID");
export type InstallationId = z.infer<typeof InstallationIdSchema>;

export const WorkspaceIdSchema = opaqueIdSchema("workspace ID");
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;

export const InboxIdSchema = opaqueIdSchema("inbox ID");
export type InboxId = z.infer<typeof InboxIdSchema>;

export const VisitorIdSchema = opaqueIdSchema("visitor ID");
export type VisitorId = z.infer<typeof VisitorIdSchema>;

export const ClientSessionIdSchema = opaqueIdSchema("client session ID");
export type ClientSessionId = z.infer<typeof ClientSessionIdSchema>;

export const ThreadIdSchema = opaqueIdSchema("thread ID");
export type ThreadId = z.infer<typeof ThreadIdSchema>;

export const ClientThreadIdSchema = opaqueIdSchema("client thread ID");
export type ClientThreadId = z.infer<typeof ClientThreadIdSchema>;

export const MessageIdSchema = opaqueIdSchema("message ID");
export type MessageId = z.infer<typeof MessageIdSchema>;

export const ClientMessageIdSchema = opaqueIdSchema("client message ID");
export type ClientMessageId = z.infer<typeof ClientMessageIdSchema>;

export const WorkflowInstanceIdSchema = opaqueIdSchema("Workflow instance ID", 100);
export type WorkflowInstanceId = z.infer<typeof WorkflowInstanceIdSchema>;

export const SessionTokenSchema = z
  .string()
  .min(16, "session token is malformed")
  .max(2_048, "session token is too long")
  .regex(/^[A-Za-z0-9._~-]+$/, "session token is malformed");
export type SessionToken = z.infer<typeof SessionTokenSchema>;

export const CursorSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "cursor must be an unsigned decimal integer")
  .refine(
    (cursor) => Number.isSafeInteger(Number(cursor)),
    "cursor must not exceed JavaScript's maximum safe integer",
  );
export type Cursor = z.infer<typeof CursorSchema>;

export const INITIAL_CURSOR: Cursor = "0";

function runtimeCrypto(): Crypto {
  const crypto = globalThis.crypto;
  if (crypto === undefined) {
    throw new Error("RespondKit ID generation requires the Web Crypto API");
  }
  return crypto;
}

function createRandomId(prefix: "cmsg" | "cthread" | "install") {
  return `${prefix}_${runtimeCrypto().randomUUID().replaceAll("-", "")}`;
}

/** Creates the stable browser-profile identifier persisted by the widget. */
export function createInstallationId(): InstallationId {
  return InstallationIdSchema.parse(createRandomId("install"));
}

/** Creates the immutable idempotency key for one customer message payload. */
export function createClientMessageId(): ClientMessageId {
  return ClientMessageIdSchema.parse(createRandomId("cmsg"));
}

/** Creates an idempotency key for a thread-creation request. */
export function createClientThreadId(): ClientThreadId {
  return ClientThreadIdSchema.parse(createRandomId("cthread"));
}

async function stableDigest(domain: string, parts: readonly string[]) {
  // JSON framing prevents ambiguous part boundaries, such as ["ab", "c"] and
  // ["a", "bc"], from sharing an input to the digest.
  const input = new TextEncoder().encode(JSON.stringify([domain, ...parts]));
  const digest = await runtimeCrypto().subtle.digest("SHA-256", input);
  const bytes = new Uint8Array(digest);

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export interface CustomerMessageIdentityInput {
  readonly workspaceId: WorkspaceId;
  readonly threadId: ThreadId;
  readonly clientMessageId: ClientMessageId;
}

export interface CustomerMessageIdentity {
  readonly messageId: MessageId;
  readonly workflowInstanceId: WorkflowInstanceId;
}

/**
 * Derives server-side identifiers from the customer's immutable idempotency
 * key. Both values stay stable across HTTP retries and Workflow retention.
 */
export async function deriveCustomerMessageIdentity(
  input: CustomerMessageIdentityInput,
): Promise<CustomerMessageIdentity> {
  const parts = [input.workspaceId, input.threadId, input.clientMessageId] as const;
  const [messageDigest, workflowDigest] = await Promise.all([
    stableDigest("respondkit/message/v1", parts),
    stableDigest("respondkit/customer-workflow/v1", parts),
  ]);

  return {
    messageId: MessageIdSchema.parse(`msg_${messageDigest}`),
    workflowInstanceId: WorkflowInstanceIdSchema.parse(`customer_${workflowDigest}`),
  };
}
