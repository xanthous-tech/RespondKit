import { describe, expect, it } from "vite-plus/test";

import { sortMessagesForDisplay, toCustomerMessageState, toMessageBusinessStatus } from "./domain";

describe("toCustomerMessageState", () => {
  it("keeps a published operator reply available after its audit fails", () => {
    const message = {
      direction: "operator_to_customer",
      customerAvailability: "available",
      processingStatus: "failed",
      discordAuditStatus: "failed",
    } as const;

    expect(toCustomerMessageState(message)).toBe("available");
    expect(toMessageBusinessStatus(message)).toBe("audit_failed");
  });

  it("does not expose a failed outgoing translation", () => {
    const message = {
      direction: "operator_to_customer",
      customerAvailability: "not_available",
      processingStatus: "failed",
      discordAuditStatus: "not_applicable",
    } as const;

    expect(toCustomerMessageState(message)).toBe("failed");
    expect(toMessageBusinessStatus(message)).toBe("not_available");
  });

  it("reports a failed customer-to-operator projection as failed", () => {
    const message = {
      direction: "customer_to_operator",
      customerAvailability: "available",
      processingStatus: "failed",
      discordAuditStatus: "not_applicable",
    } as const;

    expect(toCustomerMessageState(message)).toBe("failed");
    expect(toMessageBusinessStatus(message)).toBe("failed");
  });
});

describe("sortMessagesForDisplay", () => {
  it("orders cursor-fetched rows by accepted time and then stable ID", () => {
    const rows = [
      { rowId: 1, id: "message_b", acceptedAt: new Date(2_000) },
      { rowId: 2, id: "message_c", acceptedAt: new Date(1_000) },
      { rowId: 3, id: "message_a", acceptedAt: new Date(2_000) },
    ];

    expect(sortMessagesForDisplay(rows).map(({ id }) => id)).toEqual([
      "message_c",
      "message_a",
      "message_b",
    ]);
  });
});
