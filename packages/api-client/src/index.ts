export { AgentChatClientError, createAgentChatClient } from "./client";
export type {
  AcceptanceRetryOptions,
  AgentChatClient,
  AgentChatClientErrorOptions,
  AgentChatClientOptions,
  RequestOptions,
} from "./client";

// Customer-facing facade: @agent-chat/react can consume these without taking a
// hidden transitive dependency on @agent-chat/protocol.
export {
  createClientMessageId,
  createClientThreadId,
  createInstallationId,
} from "@agent-chat/protocol";
export type {
  ClientMessageId,
  ClientSessionV1,
  ClientThreadId,
  CreateClientSessionRequestV1,
  CreateClientSessionResponseV1,
  CreateThreadRequestV1,
  CreateThreadResponseV1,
  Cursor,
  CustomerContextV1,
  InboxId,
  InstallationId,
  ListMessagesQueryV1,
  ListMessagesResponseV1,
  MessageAcceptanceStatus,
  MessageAcceptanceV1,
  MessageDirection,
  MessageId,
  MessageState,
  MessageV1,
  SendMessageRequestV1,
  SendMessageResponseV1,
  SessionToken,
  ThreadId,
  ThreadV1,
} from "@agent-chat/protocol";
