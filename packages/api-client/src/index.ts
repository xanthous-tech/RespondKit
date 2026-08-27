export { RespondKitClientError, createRespondKitClient } from "./client";
export type {
  AcceptanceRetryOptions,
  RespondKitClient,
  RespondKitClientErrorOptions,
  RespondKitClientOptions,
  RequestOptions,
} from "./client";

// Customer-facing facade: @respondkit/react can consume these without taking a
// hidden transitive dependency on @respondkit/protocol.
export {
  createClientMessageId,
  createClientThreadId,
  createInstallationId,
} from "@respondkit/protocol";
export type {
  AcknowledgeMessagesReadRequestV1,
  AcknowledgeMessagesReadResponseV1,
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
} from "@respondkit/protocol";
