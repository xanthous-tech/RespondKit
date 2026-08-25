import {
  ClientSessionIdSchema,
  MessageIdSchema,
  ThreadIdSchema,
  VisitorIdSchema,
  WorkflowInstanceIdSchema,
  type ClientThreadId,
  type InboxId,
  type MessageId,
  type ThreadId,
  type VisitorId,
  type WorkflowInstanceId,
  type WorkspaceId,
} from "@agent-chat/protocol";

function runtimeCrypto(): Crypto {
  if (globalThis.crypto === undefined) {
    throw new Error("Agent Chat requires the Web Crypto API");
  }
  return globalThis.crypto;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function digest(domain: string, parts: readonly string[]): Promise<string> {
  const framed = new TextEncoder().encode(JSON.stringify([domain, ...parts]));
  return base64Url(new Uint8Array(await runtimeCrypto().subtle.digest("SHA-256", framed)));
}

export async function deriveVisitorId(input: {
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly installationId: string;
}): Promise<VisitorId> {
  return VisitorIdSchema.parse(
    `visitor_${await digest("agent-chat/visitor/v1", [
      input.workspaceId,
      input.inboxId,
      input.installationId,
    ])}`,
  );
}

export async function deriveThreadId(input: {
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly visitorId: VisitorId;
  readonly clientThreadId: ClientThreadId;
}): Promise<ThreadId> {
  return ThreadIdSchema.parse(
    `thread_${await digest("agent-chat/thread/v1", [
      input.workspaceId,
      input.inboxId,
      input.visitorId,
      input.clientThreadId,
    ])}`,
  );
}

export interface OperatorMessageIdentity {
  readonly messageId: MessageId;
  readonly workflowInstanceId: WorkflowInstanceId;
}

export async function deriveOperatorMessageIdentity(input: {
  readonly applicationId: string;
  readonly interactionId: string;
}): Promise<OperatorMessageIdentity> {
  const parts = [input.applicationId, input.interactionId] as const;
  const [message, workflow] = await Promise.all([
    digest("agent-chat/operator-message/v1", parts),
    digest("agent-chat/operator-workflow/v1", parts),
  ]);
  return {
    messageId: MessageIdSchema.parse(`msg_${message}`),
    workflowInstanceId: WorkflowInstanceIdSchema.parse(`operator_${workflow}`),
  };
}

export function createClientSessionId() {
  return ClientSessionIdSchema.parse(`session_${runtimeCrypto().randomUUID().replaceAll("-", "")}`);
}

export function discordInteractionAcceptedAt(interactionId: string): Date {
  if (!/^\d{1,32}$/.test(interactionId)) {
    throw new TypeError("Discord interaction ID must be a snowflake");
  }
  const discordEpoch = 1_420_070_400_000n;
  const timestamp = (BigInt(interactionId) >> 22n) + discordEpoch;
  const milliseconds = Number(timestamp);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new RangeError("Discord interaction timestamp is outside the supported range");
  }
  return new Date(milliseconds);
}

export function translationRecordId(
  messageId: MessageId,
  targetLanguage: string,
  promptVersion: string,
) {
  const suffix = `${promptVersion}_${targetLanguage}`.toLowerCase().replaceAll(/[^a-z0-9]/g, "_");
  return `translation_${messageId}_${suffix}`;
}
