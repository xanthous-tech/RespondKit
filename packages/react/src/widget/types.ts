import type { MessageDirection, MessageState } from "@agent-chat/api-client";

export type AgentChatMetadataValue = string | number | boolean | null;

export interface AgentChatContext {
  readonly inboxId: string;
  readonly userId?: string | undefined;
  readonly email?: string | undefined;
  readonly posthogDistinctId?: string | undefined;
  readonly locale?: string | undefined;
  readonly timezone?: string | undefined;
  readonly path?: string | undefined;
  readonly metadata?: Readonly<Record<string, AgentChatMetadataValue>> | undefined;
}

export type BootstrapState =
  | "idle"
  | "resolving_context"
  | "creating_session"
  | "creating_thread"
  | "ready"
  | "recoverable_error";

export type TranscriptState = "idle" | "loading" | "ready" | "stale";

export type LocalDeliveryState =
  | "optimistic"
  | "acceptance_unknown"
  | "accepted"
  | "failed_retryable";

export interface DisplayMessage {
  readonly key: string;
  readonly id?: string | undefined;
  readonly clientMessageId?: string | undefined;
  readonly direction: MessageDirection;
  readonly text: string;
  readonly acceptedAt: string;
  readonly state: MessageState;
  readonly localDelivery?: LocalDeliveryState | undefined;
}
