import { z } from "zod";

const boundedContextSchema = z.object({
  locale: z.string().max(64).optional(),
  timezone: z.string().max(64).optional(),
  posthogDistinctId: z.string().max(256).optional(),
  externalUserId: z.string().max(256).optional(),
  email: z.email().max(320).optional(),
  userAgent: z.string().max(1_024).optional(),
  country: z.string().length(2).optional(),
  region: z.string().max(128).optional(),
});

const sharedEnvelopeSchema = z.object({
  schema: z.literal("agent-chat.workflow-message/1"),
  workspaceId: z.string().min(1).max(128),
  inboxId: z.string().min(1).max(128),
  threadId: z.string().min(1).max(128),
  visitorId: z.string().min(1).max(128),
  messageId: z.string().min(1).max(128),
  workflowInstanceId: z.string().min(1).max(100),
  acceptedAt: z.string().datetime({ offset: true }),
});

export const customerWorkflowEnvelopeSchema = sharedEnvelopeSchema.extend({
  direction: z.literal("customer_to_operator"),
  clientMessageId: z.string().min(1).max(128),
  originalText: z.string().min(1).max(6_000),
  localeHint: z.string().max(64).optional(),
  context: boundedContextSchema,
});

export const operatorWorkflowEnvelopeSchema = sharedEnvelopeSchema.extend({
  direction: z.literal("operator_to_customer"),
  originalText: z.string().min(1).max(6_000),
  discord: z.object({
    integrationId: z.string().min(1).max(128),
    interactionId: z.string().min(1).max(32),
    applicationId: z.string().min(1).max(32),
    guildId: z.string().min(1).max(32),
    threadId: z.string().min(1).max(32),
    operatorId: z.string().min(1).max(32),
    operatorRoleIds: z.array(z.string().min(1).max(32)).max(100),
  }),
});

export const messageWorkflowEnvelopeSchema = z.discriminatedUnion("direction", [
  customerWorkflowEnvelopeSchema,
  operatorWorkflowEnvelopeSchema,
]);

export type MessageWorkflowEnvelope = z.infer<typeof messageWorkflowEnvelopeSchema>;
