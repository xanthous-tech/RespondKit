import { describe, expect, it } from "vite-plus/test";

import {
  ClientMessageIdSchema,
  CreateClientSessionRequestV1Schema,
  CursorSchema,
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

  it("uses decimal strings as lossless cursors", () => {
    expect(CursorSchema.parse("90071992547409930000")).toBe("90071992547409930000");
    expect(() => CursorSchema.parse("01")).toThrow();
    expect(() => CursorSchema.parse("-1")).toThrow();
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
});
