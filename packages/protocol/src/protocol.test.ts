import { describe, expect, it } from "vite-plus/test";

import {
  ClientMessageIdSchema,
  CreateClientSessionRequestV1Schema,
  CursorSchema,
  ListMessagesResponseV1Schema,
  MessageAcceptanceV1Schema,
  SendMessageRequestV1Schema,
  createClientMessageId,
  createClientThreadId,
  createInstallationId,
  deriveCustomerMessageIdentity,
} from "./index";

describe("customer protocol v1", () => {
  it("accepts bounded customer context and rejects unknown fields", () => {
    expect(
      CreateClientSessionRequestV1Schema.parse({
        inboxId: "inbox_canto",
        installationId: "install_canto",
        context: {
          userId: "user_42",
          email: "person@example.com",
          posthogDistinctId: "ph_42",
          locale: "my-MM",
          metadata: { plan: "pro", transcriptionCount: 12 },
        },
      }),
    ).toMatchObject({ installationId: "install_canto" });

    expect(() =>
      CreateClientSessionRequestV1Schema.parse({
        inboxId: "inbox_canto",
        installationId: "install_canto",
        unexpected: true,
      }),
    ).toThrow();
  });

  it("rejects blank messages without changing meaningful whitespace", () => {
    expect(() =>
      SendMessageRequestV1Schema.parse({
        clientMessageId: "cmsg_1",
        text: " \n ",
      }),
    ).toThrow("message text cannot be blank");

    expect(
      SendMessageRequestV1Schema.parse({
        clientMessageId: "cmsg_1",
        text: "  မင်္ဂလာပါ  ",
      }).text,
    ).toBe("  မင်္ဂလာပါ  ");
  });

  it("uses safe decimal D1 row IDs as cursors", () => {
    expect(CursorSchema.parse(String(Number.MAX_SAFE_INTEGER))).toBe(
      String(Number.MAX_SAFE_INTEGER),
    );
    expect(() => CursorSchema.parse("9007199254740992")).toThrow("maximum safe integer");
    expect(() => CursorSchema.parse("01")).toThrow();
    expect(() => CursorSchema.parse("-1")).toThrow();
  });

  it("rejects a list response containing a message from another thread", () => {
    expect(() =>
      ListMessagesResponseV1Schema.parse({
        threadId: "thread_expected",
        messages: [
          {
            id: "msg_1",
            threadId: "thread_other",
            direction: "operator_to_customer",
            text: "hello",
            acceptedAt: "2026-08-25T12:00:00.000Z",
            state: "available",
          },
        ],
        nextCursor: "1",
        hasMore: false,
      }),
    ).toThrow("message thread does not match");
  });

  it("creates client idempotency keys without touching browser state", () => {
    expect(ClientMessageIdSchema.parse(createClientMessageId())).toMatch(/^cmsg_/);
    expect(createClientThreadId()).toMatch(/^cthread_/);
    expect(createInstallationId()).toMatch(/^install_/);
  });

  it("derives stable, framed and bounded server identities", async () => {
    const first = await deriveCustomerMessageIdentity({
      workspaceId: "workspace_1",
      threadId: "thread_ab",
      clientMessageId: "c",
    });
    const duplicate = await deriveCustomerMessageIdentity({
      workspaceId: "workspace_1",
      threadId: "thread_ab",
      clientMessageId: "c",
    });
    const differentBoundary = await deriveCustomerMessageIdentity({
      workspaceId: "workspace_1",
      threadId: "thread_a",
      clientMessageId: "bc",
    });

    expect(duplicate).toEqual(first);
    expect(differentBoundary).not.toEqual(first);
    expect(first.workflowInstanceId.length).toBeLessThanOrEqual(100);
  });

  it("does not allow a canonical response to change the immutable message", () => {
    expect(() =>
      MessageAcceptanceV1Schema.parse({
        messageId: "msg_expected",
        clientMessageId: "cmsg_expected",
        status: "available",
        message: {
          id: "msg_other",
          threadId: "thread_1",
          clientMessageId: "cmsg_expected",
          direction: "customer_to_operator",
          text: "hello",
          acceptedAt: "2026-08-25T12:00:00.000Z",
          state: "available",
        },
      }),
    ).toThrow("canonical message does not match");
  });

  it("requires an embedded canonical message state to match its acceptance status", () => {
    expect(() =>
      MessageAcceptanceV1Schema.parse({
        messageId: "msg_1",
        clientMessageId: "cmsg_1",
        status: "processing",
        message: {
          id: "msg_1",
          threadId: "thread_1",
          clientMessageId: "cmsg_1",
          direction: "customer_to_operator",
          text: "hello",
          acceptedAt: "2026-08-25T12:00:00.000Z",
          state: "available",
        },
      }),
    ).toThrow("state does not match");

    expect(() =>
      MessageAcceptanceV1Schema.parse({
        messageId: "msg_1",
        clientMessageId: "cmsg_1",
        status: "accepted",
        message: {
          id: "msg_1",
          threadId: "thread_1",
          clientMessageId: "cmsg_1",
          direction: "customer_to_operator",
          text: "hello",
          acceptedAt: "2026-08-25T12:00:00.000Z",
          state: "processing",
        },
      }),
    ).toThrow("state does not match");
  });

  it("accepts the full persisted failure-code width", () => {
    expect(
      MessageAcceptanceV1Schema.parse({
        messageId: "msg_1",
        clientMessageId: "cmsg_1",
        status: "failed",
        failureCode: "f".repeat(128),
      }).failureCode,
    ).toHaveLength(128);

    expect(() =>
      MessageAcceptanceV1Schema.parse({
        messageId: "msg_1",
        clientMessageId: "cmsg_1",
        status: "failed",
        failureCode: "f".repeat(129),
      }),
    ).toThrow();
  });
});
