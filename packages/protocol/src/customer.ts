import { z } from "zod";

import {
  ClientMessageIdSchema,
  ClientSessionIdSchema,
  ClientThreadIdSchema,
  CursorSchema,
  InboxIdSchema,
  InstallationIdSchema,
  MessageIdSchema,
  SessionTokenSchema,
  ThreadIdSchema,
  VisitorIdSchema,
} from "./ids";

export const API_VERSION = "v1" as const;

export const LanguageTagSchema = z
  .string()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/, "invalid language tag");
export type LanguageTag = z.infer<typeof LanguageTagSchema>;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

const MetadataSchema = z
  .record(z.string().min(1).max(64), JsonValueSchema)
  .superRefine((metadata, context) => {
    if (Object.keys(metadata).length > 32) {
      context.addIssue({
        code: "custom",
        message: "metadata may contain at most 32 keys",
      });
    }

    if (JSON.stringify(metadata).length > 16_384) {
      context.addIssue({
        code: "custom",
        message: "metadata may contain at most 16 KiB of JSON",
      });
    }
  });

export const CustomerContextV1Schema = z
  .object({
    userId: z.string().min(1).max(256).optional(),
    email: z.email().max(320).optional(),
    posthogDistinctId: z.string().min(1).max(256).optional(),
    locale: LanguageTagSchema.optional(),
    timezone: z.string().min(1).max(64).optional(),
    metadata: MetadataSchema.optional(),
  })
  .strict();
export type CustomerContextV1 = z.infer<typeof CustomerContextV1Schema>;

export const CreateClientSessionRequestV1Schema = z
  .object({
    inboxId: InboxIdSchema,
    installationId: InstallationIdSchema,
    context: CustomerContextV1Schema.optional(),
  })
  .strict();
export type CreateClientSessionRequestV1 = z.infer<typeof CreateClientSessionRequestV1Schema>;

export const ClientSessionV1Schema = z
  .object({
    id: ClientSessionIdSchema,
    token: SessionTokenSchema,
    visitorId: VisitorIdSchema,
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type ClientSessionV1 = z.infer<typeof ClientSessionV1Schema>;

export const CreateClientSessionResponseV1Schema = z
  .object({
    session: ClientSessionV1Schema,
  })
  .strict();
export type CreateClientSessionResponseV1 = z.infer<typeof CreateClientSessionResponseV1Schema>;

export const ThreadStateSchema = z.enum(["open", "closed"]);
export type ThreadState = z.infer<typeof ThreadStateSchema>;

export const ThreadV1Schema = z
  .object({
    id: ThreadIdSchema,
    clientThreadId: ClientThreadIdSchema,
    state: ThreadStateSchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type ThreadV1 = z.infer<typeof ThreadV1Schema>;

export const CreateThreadRequestV1Schema = z
  .object({
    clientThreadId: ClientThreadIdSchema,
  })
  .strict();
export type CreateThreadRequestV1 = z.infer<typeof CreateThreadRequestV1Schema>;

export const CreateThreadResponseV1Schema = z
  .object({
    thread: ThreadV1Schema,
  })
  .strict();
export type CreateThreadResponseV1 = z.infer<typeof CreateThreadResponseV1Schema>;

export const MessageDirectionSchema = z.enum(["customer_to_operator", "operator_to_customer"]);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

export const MessageStateSchema = z.enum(["processing", "available", "failed"]);
export type MessageState = z.infer<typeof MessageStateSchema>;

export const MessageV1Schema = z
  .object({
    id: MessageIdSchema,
    threadId: ThreadIdSchema,
    clientMessageId: ClientMessageIdSchema.optional(),
    direction: MessageDirectionSchema,
    // A translated operator reply can expand beyond Discord's 6,000-character
    // command input even though new customer input is capped below.
    text: z.string().min(1).max(24_000),
    language: LanguageTagSchema.optional(),
    acceptedAt: z.iso.datetime({ offset: true }),
    state: MessageStateSchema,
  })
  .strict();
export type MessageV1 = z.infer<typeof MessageV1Schema>;

export const ListMessagesQueryV1Schema = z
  .object({
    after: CursorSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type ListMessagesQueryV1 = z.infer<typeof ListMessagesQueryV1Schema>;

export const ListMessagesResponseV1Schema = z
  .object({
    threadId: ThreadIdSchema,
    messages: z.array(MessageV1Schema).max(100),
    nextCursor: CursorSchema,
    hasMore: z.boolean(),
  })
  .strict()
  .superRefine((response, context) => {
    for (const [index, message] of response.messages.entries()) {
      if (message.threadId !== response.threadId) {
        context.addIssue({
          code: "custom",
          path: ["messages", index, "threadId"],
          message: "message thread does not match the response thread",
        });
      }
    }
  });
export type ListMessagesResponseV1 = z.infer<typeof ListMessagesResponseV1Schema>;

const nonBlankMessageText = z
  .string()
  .min(1)
  .max(6_000)
  .refine((text) => text.trim().length > 0, "message text cannot be blank");

export const SendMessageRequestV1Schema = z
  .object({
    clientMessageId: ClientMessageIdSchema,
    text: nonBlankMessageText,
  })
  .strict();
export type SendMessageRequestV1 = z.infer<typeof SendMessageRequestV1Schema>;

export const MessageAcceptanceStatusSchema = z.enum([
  "accepted",
  "already_accepted",
  "acceptance_unknown",
  "processing",
  "available",
  "failed",
]);
export type MessageAcceptanceStatus = z.infer<typeof MessageAcceptanceStatusSchema>;

export const MessageAcceptanceV1Schema = z
  .object({
    messageId: MessageIdSchema,
    clientMessageId: ClientMessageIdSchema,
    status: MessageAcceptanceStatusSchema,
    message: MessageV1Schema.optional(),
    failureCode: z.string().min(1).max(128).optional(),
  })
  .strict()
  .superRefine((acceptance, context) => {
    if (
      acceptance.message !== undefined &&
      (acceptance.message.id !== acceptance.messageId ||
        acceptance.message.clientMessageId !== acceptance.clientMessageId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["message"],
        message: "canonical message does not match the accepted message identity",
      });
    }

    if (
      acceptance.message !== undefined &&
      acceptance.message.direction !== "customer_to_operator"
    ) {
      context.addIssue({
        code: "custom",
        path: ["message", "direction"],
        message: "a customer acceptance may only include the customer message",
      });
    }

    if (acceptance.status === "available" && acceptance.message === undefined) {
      context.addIssue({
        code: "custom",
        path: ["message"],
        message: "an available acceptance must include its canonical message",
      });
    }

    const expectedMessageState =
      acceptance.status === "processing" ||
      acceptance.status === "available" ||
      acceptance.status === "failed"
        ? acceptance.status
        : undefined;
    if (
      acceptance.message !== undefined &&
      (expectedMessageState === undefined || acceptance.message.state !== expectedMessageState)
    ) {
      context.addIssue({
        code: "custom",
        path: ["message", "state"],
        message: "canonical message state does not match its acceptance status",
      });
    }

    if (acceptance.status !== "failed" && acceptance.failureCode !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "only a failed acceptance may include a failure code",
      });
    }
  });
export type MessageAcceptanceV1 = z.infer<typeof MessageAcceptanceV1Schema>;

export const SendMessageResponseV1Schema = z
  .object({
    acceptance: MessageAcceptanceV1Schema,
  })
  .strict();
export type SendMessageResponseV1 = z.infer<typeof SendMessageResponseV1Schema>;
