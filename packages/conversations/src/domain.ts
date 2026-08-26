import type { MessageState } from "@respondkit/protocol";

import type {
  CustomerAvailabilityStatus,
  DiscordAuditStatus,
  MessageProcessingStatus,
} from "./schema";

export interface MessageStateFields {
  readonly direction: "customer_to_operator" | "operator_to_customer";
  readonly processingStatus: MessageProcessingStatus;
  readonly customerAvailability: CustomerAvailabilityStatus;
  readonly discordAuditStatus: DiscordAuditStatus;
}

export type MessageBusinessStatus =
  | "processing"
  | "available"
  | "audit_failed"
  | "not_available"
  | "failed";

/**
 * Reduces the richer persistence state to the state exposed by the customer API.
 * An operator reply stays available even if its later Discord audit fails.
 */
export function toCustomerMessageState(message: MessageStateFields): MessageState {
  if (
    message.direction === "operator_to_customer" &&
    message.customerAvailability === "available"
  ) {
    return "available";
  }

  if (message.processingStatus === "failed") {
    return "failed";
  }

  if (message.processingStatus === "succeeded") {
    return "available";
  }

  return "processing";
}

/** Provides stage-aware wording for duplicate Workflow reconciliation. */
export function toMessageBusinessStatus(message: MessageStateFields): MessageBusinessStatus {
  if (
    message.direction === "operator_to_customer" &&
    message.customerAvailability === "available"
  ) {
    return message.discordAuditStatus === "failed" ? "audit_failed" : "available";
  }

  if (
    message.direction === "operator_to_customer" &&
    message.customerAvailability === "not_available"
  ) {
    return "not_available";
  }

  if (message.processingStatus === "failed") {
    return "failed";
  }

  return message.processingStatus === "succeeded" ? "available" : "processing";
}

export interface DisplaySortableMessage {
  readonly id: string;
  readonly acceptedAt: Date | string | number;
}

function timestamp(value: Date | string | number): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  return typeof value === "number" ? value : new Date(value).getTime();
}

/**
 * D1 rows are paged by their committed row cursor, then ordered for display by
 * the server-stamped acceptance timestamp and stable public ID.
 */
export function sortMessagesForDisplay<const TMessage extends DisplaySortableMessage>(
  rows: readonly TMessage[],
): TMessage[] {
  return [...rows].sort((left, right) => {
    const acceptedAtDifference = timestamp(left.acceptedAt) - timestamp(right.acceptedAt);

    return acceptedAtDifference === 0 ? left.id.localeCompare(right.id) : acceptedAtDifference;
  });
}
