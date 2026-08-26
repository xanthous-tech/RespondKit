import type {
  ClientMessageId,
  ClientThreadId,
  Cursor,
  InboxId,
  ListMessagesResponseV1,
  MessageId,
  MessageV1,
  ThreadId,
  VisitorId,
  WorkflowInstanceId,
  WorkspaceId,
} from "@respondkit/protocol";
import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { sortMessagesForDisplay, toCustomerMessageState } from "./domain";
import {
  customerTranscriptEntries,
  messageTranslations,
  messages,
  threads,
  type CustomerTranscriptEventKind,
  type MessageFailureStage,
  type MessageRow,
  type MessageTranslationRow,
  type ThreadRow,
} from "./schema";

const activeProcessingStatuses = ["processing", "retrying"] as const;

export interface CreateThreadInput {
  readonly id: ThreadId;
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly visitorId: VisitorId;
  readonly clientThreadId: ClientThreadId;
  readonly createdAt: Date;
  readonly customerLanguage?: string | null;
}

export class ThreadIdentityConflictError extends Error {
  override readonly name = "ThreadIdentityConflictError";

  constructor(threadId: ThreadId) {
    super(`Thread ${threadId} conflicts with an existing thread identity`);
  }
}

export class MessageIdentityConflictError extends Error {
  override readonly name = "MessageIdentityConflictError";

  constructor(messageId: MessageId) {
    super(`Message ${messageId} conflicts with an existing message identity`);
  }
}

export class MessageStateConflictError extends Error {
  override readonly name = "MessageStateConflictError";

  constructor(messageId: MessageId, operation: string) {
    super(`Message ${messageId} cannot ${operation} from its current state`);
  }
}

export async function createThread(
  db: DrizzleD1Database,
  input: CreateThreadInput,
): Promise<ThreadRow> {
  await db
    .insert(threads)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      inboxId: input.inboxId,
      visitorId: input.visitorId,
      clientThreadId: input.clientThreadId,
      customerLanguage: input.customerLanguage,
      customerLanguageUpdatedAt: input.customerLanguage == null ? null : input.createdAt,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      lastActivityAt: input.createdAt,
    })
    .onConflictDoNothing();

  const [thread] = await db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.workspaceId, input.workspaceId),
        eq(threads.inboxId, input.inboxId),
        eq(threads.visitorId, input.visitorId),
        eq(threads.clientThreadId, input.clientThreadId),
      ),
    )
    .limit(1);

  if (!thread || thread.id !== input.id) {
    throw new ThreadIdentityConflictError(input.id);
  }

  return thread;
}

export async function findThreadById(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
    readonly threadId: ThreadId;
  },
): Promise<ThreadRow | null> {
  const [thread] = await db.select().from(threads).where(threadScope(input)).limit(1);

  return thread ?? null;
}

export async function closeThread(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
    readonly threadId: ThreadId;
    readonly closedAt: Date;
  },
): Promise<ThreadRow | null> {
  const [thread] = await db
    .update(threads)
    .set({
      status: "closed",
      closedAt: input.closedAt,
      updatedAt: input.closedAt,
    })
    .where(threadScope(input))
    .returning();

  return thread ?? null;
}

function threadScope(input: {
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly threadId: ThreadId;
}) {
  return and(
    eq(threads.workspaceId, input.workspaceId),
    eq(threads.inboxId, input.inboxId),
    eq(threads.id, input.threadId),
  );
}

export interface CustomerIngressInput {
  readonly id: MessageId;
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly threadId: ThreadId;
  readonly clientMessageId: ClientMessageId;
  readonly workflowInstanceId: WorkflowInstanceId;
  readonly acceptedAt: Date;
  readonly originalText: string;
  readonly localeHint?: string | null;
}

export interface OperatorMessageInput {
  readonly id: MessageId;
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly threadId: ThreadId;
  readonly workflowInstanceId: WorkflowInstanceId;
  readonly acceptedAt: Date;
  readonly originalEnglishText: string;
}

export type IngressAcceptanceKind =
  | "inserted"
  | "existing"
  | "resumed"
  | "already_succeeded"
  | "already_failed";

export interface CustomerIngressAcceptance {
  readonly kind: IngressAcceptanceKind;
  readonly immutablePayloadMatches: boolean;
  readonly message: MessageRow;
}

/**
 * Builds the conversation-owned portion of Discord's atomic interaction batch.
 * The Discord package combines these with its receipt and executes one D1 batch.
 */
export function prepareOperatorMessageStatements(
  db: DrizzleD1Database,
  input: OperatorMessageInput,
) {
  return [
    db
      .insert(messages)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        inboxId: input.inboxId,
        threadId: input.threadId,
        clientMessageId: null,
        workflowInstanceId: input.workflowInstanceId,
        direction: "operator_to_customer",
        originalText: input.originalEnglishText,
        originalLanguage: "en",
        customerVisibleText: null,
        customerVisibleLanguage: null,
        operatorVisibleText: input.originalEnglishText,
        acceptedAt: input.acceptedAt,
        processingGeneration: 1,
        processingStatus: "processing",
        customerAvailability: "pending",
        operatorProjectionStatus: "not_applicable",
        discordAuditStatus: "pending",
        createdAt: input.acceptedAt,
        updatedAt: input.acceptedAt,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id }),
    prepareThreadActivityStatement(db, input),
  ] as const;
}

export async function acceptCustomerIngress(
  db: DrizzleD1Database,
  input: CustomerIngressInput,
): Promise<CustomerIngressAcceptance> {
  const [inserted] = await db.batch([
    db
      .insert(messages)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        inboxId: input.inboxId,
        threadId: input.threadId,
        clientMessageId: input.clientMessageId,
        workflowInstanceId: input.workflowInstanceId,
        direction: "customer_to_operator",
        originalText: input.originalText,
        originalLanguage: null,
        customerVisibleText: input.originalText,
        customerVisibleLanguage: input.localeHint,
        operatorVisibleText: null,
        acceptedAt: input.acceptedAt,
        processingGeneration: 1,
        processingStatus: "processing",
        customerAvailability: "available",
        operatorProjectionStatus: "pending",
        discordAuditStatus: "not_applicable",
        createdAt: input.acceptedAt,
        updatedAt: input.acceptedAt,
      })
      .onConflictDoNothing()
      .returning({ id: messages.id }),
    prepareCustomerTranscriptEventStatement(db, {
      workspaceId: input.workspaceId,
      inboxId: input.inboxId,
      threadId: input.threadId,
      messageId: input.id,
      generation: 1,
      eventKind: "processing",
    }),
    prepareThreadActivityStatement(db, input),
  ]);

  const [canonical] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, input.workspaceId),
        eq(messages.threadId, input.threadId),
        eq(messages.clientMessageId, input.clientMessageId),
      ),
    )
    .limit(1);

  if (!canonical || canonical.id !== input.id) {
    throw new MessageIdentityConflictError(input.id);
  }

  const immutablePayloadMatches =
    canonical.workflowInstanceId === input.workflowInstanceId &&
    canonical.originalText === input.originalText;

  return {
    kind: inserted.length > 0 ? "inserted" : ingressKindFromMessage(canonical),
    immutablePayloadMatches,
    message: canonical,
  };
}

function ingressKindFromMessage(message: MessageRow): IngressAcceptanceKind {
  switch (message.processingStatus) {
    case "retrying":
      return "resumed";
    case "succeeded":
      return "already_succeeded";
    case "failed":
      return "already_failed";
    case "processing":
      return "existing";
  }
}

function prepareThreadActivityStatement(
  db: DrizzleD1Database,
  input: {
    readonly id: MessageId;
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
    readonly threadId: ThreadId;
  },
) {
  const canonicalAcceptedAt = sql<number>`coalesce(
    (select ${messages.acceptedAt}
      from ${messages}
      where ${messages.id} = ${input.id}
        and ${messages.workspaceId} = ${input.workspaceId}
        and ${messages.inboxId} = ${input.inboxId}
        and ${messages.threadId} = ${input.threadId}
      limit 1),
    ${threads.lastActivityAt}
  )`;

  return db
    .update(threads)
    .set({
      lastActivityAt: sql`max(${threads.lastActivityAt}, ${canonicalAcceptedAt})`,
      updatedAt: sql`max(${threads.updatedAt}, ${canonicalAcceptedAt})`,
    })
    .where(threadScope(input));
}

function customerTranscriptEventPredicate(eventKind: CustomerTranscriptEventKind) {
  const operatorReplyIsAvailable = and(
    eq(messages.direction, "operator_to_customer"),
    eq(messages.customerAvailability, "available"),
  );

  switch (eventKind) {
    case "processing":
      return and(
        inArray(messages.processingStatus, activeProcessingStatuses),
        sql`not (${operatorReplyIsAvailable})`,
      );
    case "available":
      return or(eq(messages.processingStatus, "succeeded"), operatorReplyIsAvailable);
    case "failed":
      return and(eq(messages.processingStatus, "failed"), sql`not (${operatorReplyIsAvailable})`);
  }
}

function prepareCustomerTranscriptEventStatement(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
    readonly generation: number;
    readonly eventKind: CustomerTranscriptEventKind;
  },
) {
  return db
    .insert(customerTranscriptEntries)
    .select(
      db
        .select({
          rowId: sql<number>`null`.as("row_id"),
          workspaceId: messages.workspaceId,
          inboxId: messages.inboxId,
          threadId: messages.threadId,
          messageId: messages.id,
          processingGeneration: messages.processingGeneration,
          eventKind: sql<CustomerTranscriptEventKind>`${input.eventKind}`.as("event_kind"),
          eventAt: messages.updatedAt,
        })
        .from(messages)
        .where(
          and(
            messageScope(input),
            eq(messages.processingGeneration, input.generation),
            sql`${messages.customerVisibleText} is not null`,
            customerTranscriptEventPredicate(input.eventKind),
          ),
        ),
    )
    .onConflictDoNothing();
}

export async function findMessageById(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
    readonly threadId: ThreadId;
    readonly messageId: MessageId;
  },
): Promise<MessageRow | null> {
  const [message] = await db.select().from(messages).where(messageScope(input)).limit(1);

  return message ?? null;
}

export async function findCustomerMessageByClientId(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
    readonly threadId: ThreadId;
    readonly clientMessageId: ClientMessageId;
  },
): Promise<MessageRow | null> {
  const [message] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, input.workspaceId),
        eq(messages.inboxId, input.inboxId),
        eq(messages.threadId, input.threadId),
        eq(messages.clientMessageId, input.clientMessageId),
        eq(messages.direction, "customer_to_operator"),
      ),
    )
    .limit(1);

  return message ?? null;
}

export async function findMessageByWorkflowInstanceId(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly workflowInstanceId: WorkflowInstanceId;
  },
): Promise<MessageRow | null> {
  const [message] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, input.workspaceId),
        eq(messages.workflowInstanceId, input.workflowInstanceId),
      ),
    )
    .limit(1);

  return message ?? null;
}

function messageScope(input: {
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
}) {
  return and(
    eq(messages.id, input.messageId),
    eq(messages.workspaceId, input.workspaceId),
    eq(messages.inboxId, input.inboxId),
    eq(messages.threadId, input.threadId),
  );
}

export interface StoreTranslationInput {
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly generation: number;
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly translatedText: string;
  readonly promptVersion: string;
  readonly provider: string;
  readonly model: string;
  readonly isPassThrough: boolean;
  readonly mixedLanguage: boolean;
  readonly needsReview: boolean;
  readonly translatedAt: Date;
}

function prepareTranslationInsert(db: DrizzleD1Database, input: StoreTranslationInput) {
  return db
    .insert(messageTranslations)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      inboxId: input.inboxId,
      threadId: input.threadId,
      messageId: input.messageId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      translatedText: input.translatedText,
      promptVersion: input.promptVersion,
      provider: input.provider,
      model: input.model,
      isPassThrough: input.isPassThrough,
      mixedLanguage: input.mixedLanguage,
      needsReview: input.needsReview,
      createdAt: input.translatedAt,
    })
    .onConflictDoNothing();
}

function canonicalTranslationValue(
  input: StoreTranslationInput,
  column:
    | typeof messageTranslations.translatedText
    | typeof messageTranslations.sourceLanguage
    | typeof messageTranslations.targetLanguage,
) {
  return sql<string>`(
    select ${column}
    from ${messageTranslations}
    where ${messageTranslations.messageId} = ${input.messageId}
      and ${messageTranslations.targetLanguage} = ${input.targetLanguage}
      and ${messageTranslations.promptVersion} = ${input.promptVersion}
    limit 1
  )`;
}

export async function storeCustomerTranslation(
  db: DrizzleD1Database,
  input: StoreTranslationInput,
): Promise<{ message: MessageRow; translation: MessageTranslationRow }> {
  const canonicalText = canonicalTranslationValue(input, messageTranslations.translatedText);
  const canonicalSourceLanguage = canonicalTranslationValue(
    input,
    messageTranslations.sourceLanguage,
  );
  const canonicalNeedsReview = sql<number>`coalesce((
    select ${messageTranslations.needsReview}
    from ${messageTranslations}
    where ${messageTranslations.messageId} = ${input.messageId}
      and ${messageTranslations.targetLanguage} = ${input.targetLanguage}
      and ${messageTranslations.promptVersion} = ${input.promptVersion}
    limit 1
  ), 1)`;
  const canonicalAcceptedAt = sql<number>`(
    select ${messages.acceptedAt}
    from ${messages}
    where ${messages.id} = ${input.messageId}
    limit 1
  )`;

  await db.batch([
    prepareTranslationInsert(db, input),
    db
      .update(messages)
      .set({
        originalLanguage: canonicalSourceLanguage,
        customerVisibleLanguage: canonicalSourceLanguage,
        operatorVisibleText: canonicalText,
        updatedAt: input.translatedAt,
      })
      .where(
        and(
          messageScope(input),
          eq(messages.direction, "customer_to_operator"),
          eq(messages.processingGeneration, input.generation),
          inArray(messages.processingStatus, activeProcessingStatuses),
        ),
      ),
    db
      .update(threads)
      .set({
        customerLanguage: sql`case
          when not ${canonicalNeedsReview}
            and (${threads.customerLanguageUpdatedAt} is null
              or ${threads.customerLanguageUpdatedAt} <= ${canonicalAcceptedAt})
          then ${canonicalSourceLanguage}
          else ${threads.customerLanguage}
        end`,
        customerLanguageUpdatedAt: sql`case
          when not ${canonicalNeedsReview}
            and (${threads.customerLanguageUpdatedAt} is null
              or ${threads.customerLanguageUpdatedAt} <= ${canonicalAcceptedAt})
          then ${canonicalAcceptedAt}
          else ${threads.customerLanguageUpdatedAt}
        end`,
        updatedAt: sql`max(${threads.updatedAt}, ${canonicalAcceptedAt})`,
      })
      .where(
        and(
          threadScope(input),
          sql`exists (
            select 1
            from ${messages}
            where ${messages.id} = ${input.messageId}
              and ${messages.workspaceId} = ${input.workspaceId}
              and ${messages.inboxId} = ${input.inboxId}
              and ${messages.threadId} = ${input.threadId}
              and ${messages.direction} = 'customer_to_operator'
              and ${messages.processingGeneration} = ${input.generation}
              and ${messages.processingStatus} in ('processing', 'retrying')
          )`,
        ),
      ),
  ]);

  return requireTranslationResult(
    db,
    input,
    "customer_to_operator",
    "store its incoming translation",
  );
}

export async function publishOperatorReply(
  db: DrizzleD1Database,
  input: StoreTranslationInput,
): Promise<{ message: MessageRow; translation: MessageTranslationRow }> {
  const canonicalText = canonicalTranslationValue(input, messageTranslations.translatedText);
  const canonicalTargetLanguage = canonicalTranslationValue(
    input,
    messageTranslations.targetLanguage,
  );

  await db.batch([
    prepareTranslationInsert(db, input),
    db
      .update(messages)
      .set({
        customerVisibleText: canonicalText,
        customerVisibleLanguage: canonicalTargetLanguage,
        customerAvailability: "available",
        discordAuditStatus: "pending",
        updatedAt: input.translatedAt,
      })
      .where(
        and(
          messageScope(input),
          eq(messages.direction, "operator_to_customer"),
          eq(messages.processingGeneration, input.generation),
          inArray(messages.processingStatus, activeProcessingStatuses),
        ),
      ),
    prepareCustomerTranscriptEventStatement(db, {
      ...input,
      eventKind: "available",
    }),
  ]);

  return requireTranslationResult(
    db,
    input,
    "operator_to_customer",
    "publish its translated reply",
  );
}

async function requireTranslationResult(
  db: DrizzleD1Database,
  input: StoreTranslationInput,
  expectedDirection: MessageRow["direction"],
  operation: string,
): Promise<{ message: MessageRow; translation: MessageTranslationRow }> {
  const [message, translation] = await Promise.all([
    findMessageById(db, input),
    findTranslation(db, input),
  ]);

  if (
    !message ||
    message.processingGeneration !== input.generation ||
    message.direction !== expectedDirection
  ) {
    throw new MessageStateConflictError(input.messageId, operation);
  }

  if (!translation) {
    throw new MessageIdentityConflictError(input.messageId);
  }

  const expectedVisibleText =
    expectedDirection === "customer_to_operator"
      ? message.operatorVisibleText
      : message.customerVisibleText;

  if (expectedVisibleText !== translation.translatedText) {
    throw new MessageStateConflictError(input.messageId, operation);
  }

  return { message, translation };
}

export async function findTranslation(
  db: DrizzleD1Database,
  input: {
    readonly messageId: MessageId;
    readonly targetLanguage: string;
    readonly promptVersion: string;
  },
): Promise<MessageTranslationRow | null> {
  const [translation] = await db
    .select()
    .from(messageTranslations)
    .where(
      and(
        eq(messageTranslations.messageId, input.messageId),
        eq(messageTranslations.targetLanguage, input.targetLanguage),
        eq(messageTranslations.promptVersion, input.promptVersion),
      ),
    )
    .limit(1);

  return translation ?? null;
}

export async function markCustomerMessageProjected(
  db: DrizzleD1Database,
  input: MessageTransitionInput,
): Promise<MessageRow> {
  await db.batch([
    db
      .update(messages)
      .set({
        operatorProjectionStatus: "projected",
        processingStatus: "succeeded",
        failureStage: null,
        failureCode: null,
        updatedAt: input.transitionedAt,
      })
      .where(
        and(
          messageScope(input),
          eq(messages.direction, "customer_to_operator"),
          eq(messages.processingGeneration, input.generation),
          inArray(messages.processingStatus, activeProcessingStatuses),
        ),
      ),
    prepareCustomerTranscriptEventStatement(db, {
      ...input,
      eventKind: "available",
    }),
  ]);

  const message = await requireMessageGeneration(db, input, "mark as projected");

  if (
    message.direction !== "customer_to_operator" ||
    message.operatorProjectionStatus !== "projected" ||
    message.processingStatus !== "succeeded"
  ) {
    throw new MessageStateConflictError(input.messageId, "mark as projected");
  }

  return message;
}

export async function markOperatorAuditProjected(
  db: DrizzleD1Database,
  input: MessageTransitionInput,
): Promise<MessageRow> {
  await db
    .update(messages)
    .set({
      discordAuditStatus: "projected",
      processingStatus: "succeeded",
      failureStage: null,
      failureCode: null,
      updatedAt: input.transitionedAt,
    })
    .where(
      and(
        messageScope(input),
        eq(messages.direction, "operator_to_customer"),
        eq(messages.customerAvailability, "available"),
        eq(messages.processingGeneration, input.generation),
        inArray(messages.processingStatus, activeProcessingStatuses),
      ),
    );

  const message = await requireMessageGeneration(db, input, "mark its audit as projected");

  if (
    message.direction !== "operator_to_customer" ||
    message.customerAvailability !== "available" ||
    message.discordAuditStatus !== "projected" ||
    message.processingStatus !== "succeeded"
  ) {
    throw new MessageStateConflictError(input.messageId, "mark its audit as projected");
  }

  return message;
}

export interface MessageTransitionInput {
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly generation: number;
  readonly transitionedAt: Date;
}

export async function recordTerminalFailure(
  db: DrizzleD1Database,
  input: MessageTransitionInput & {
    readonly stage: MessageFailureStage;
    readonly failureCode: string;
  },
): Promise<MessageRow> {
  if (input.failureCode.length < 1 || input.failureCode.length > 128) {
    throw new RangeError("failureCode must contain between 1 and 128 characters");
  }

  await db.batch([
    db
      .update(messages)
      .set({
        processingStatus: "failed",
        customerAvailability: sql`case
          when ${messages.direction} = 'customer_to_operator'
            or ${messages.customerAvailability} = 'available'
          then ${messages.customerAvailability}
          else 'not_available'
        end`,
        operatorProjectionStatus: sql`case
          when ${messages.direction} = 'customer_to_operator'
            and ${messages.operatorProjectionStatus} != 'projected'
          then 'failed'
          else ${messages.operatorProjectionStatus}
        end`,
        discordAuditStatus: sql`case
          when ${messages.direction} = 'operator_to_customer'
            and ${messages.customerAvailability} = 'available'
            and ${input.stage} = 'discord_audit'
          then 'failed'
          when ${messages.direction} = 'operator_to_customer'
            and ${messages.customerAvailability} != 'available'
          then 'not_applicable'
          else ${messages.discordAuditStatus}
        end`,
        failureStage: input.stage,
        failureCode: input.failureCode,
        updatedAt: input.transitionedAt,
      })
      .where(
        and(
          messageScope(input),
          eq(messages.processingGeneration, input.generation),
          inArray(messages.processingStatus, ["processing", "retrying", "failed"]),
        ),
      ),
    prepareCustomerTranscriptEventStatement(db, {
      ...input,
      eventKind: "failed",
    }),
  ]);

  const message = await requireMessageGeneration(db, input, "record terminal failure");

  if (
    message.processingStatus !== "failed" ||
    message.failureStage !== input.stage ||
    message.failureCode !== input.failureCode
  ) {
    throw new MessageStateConflictError(input.messageId, "record terminal failure");
  }

  return message;
}

export async function reopenMessageForRetry(
  db: DrizzleD1Database,
  input: Omit<MessageTransitionInput, "transitionedAt"> & {
    readonly reopenedAt: Date;
    readonly requireCustomerUnavailable?: boolean;
  },
): Promise<MessageRow> {
  const customerAvailabilityGuard = input.requireCustomerUnavailable
    ? eq(messages.customerAvailability, "not_available")
    : sql`true`;

  const nextGeneration = input.generation + 1;
  const [reopened] = await db.batch([
    db
      .update(messages)
      .set({
        processingGeneration: sql`${messages.processingGeneration} + 1`,
        processingStatus: "retrying",
        customerAvailability: sql`case
          when ${messages.direction} = 'operator_to_customer' then 'pending'
          else ${messages.customerAvailability}
        end`,
        operatorProjectionStatus: sql`case
          when ${messages.direction} = 'customer_to_operator' then 'pending'
          else ${messages.operatorProjectionStatus}
        end`,
        discordAuditStatus: sql`case
          when ${messages.direction} = 'operator_to_customer' then 'pending'
          else ${messages.discordAuditStatus}
        end`,
        failureStage: null,
        failureCode: null,
        updatedAt: input.reopenedAt,
      })
      .where(
        and(
          messageScope(input),
          eq(messages.processingGeneration, input.generation),
          eq(messages.processingStatus, "failed"),
          customerAvailabilityGuard,
        ),
      )
      .returning(),
    prepareCustomerTranscriptEventStatement(db, {
      ...input,
      generation: nextGeneration,
      eventKind: "processing",
    }),
  ]);

  const message = reopened[0] ?? (await findMessageById(db, input));
  if (
    !message ||
    message.processingGeneration !== nextGeneration ||
    message.processingStatus !== "retrying"
  ) {
    throw new MessageStateConflictError(input.messageId, "reopen for retry");
  }

  return message;
}

async function requireMessageGeneration(
  db: DrizzleD1Database,
  input: Omit<MessageTransitionInput, "transitionedAt">,
  operation: string,
): Promise<MessageRow> {
  const message = await findMessageById(db, input);

  if (!message || message.processingGeneration !== input.generation) {
    throw new MessageStateConflictError(input.messageId, operation);
  }

  return message;
}

export interface TranslationContextTurn {
  readonly messageId: MessageId;
  readonly role: "customer" | "operator";
  readonly englishText: string;
  readonly acceptedAt: Date;
}

export async function loadEnglishTranslationContext(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
    readonly threadId: ThreadId;
    readonly before: Date;
    readonly limit?: number;
  },
): Promise<TranslationContextTurn[]> {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const rows = await db
    .select({
      messageId: messages.id,
      direction: messages.direction,
      englishText: messages.operatorVisibleText,
      acceptedAt: messages.acceptedAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.workspaceId, input.workspaceId),
        eq(messages.inboxId, input.inboxId),
        eq(messages.threadId, input.threadId),
        sql`${messages.operatorVisibleText} is not null`,
        or(
          eq(messages.direction, "customer_to_operator"),
          eq(messages.customerAvailability, "available"),
        ),
        sql`${messages.acceptedAt} < ${input.before.getTime()}`,
      ),
    )
    .orderBy(desc(messages.acceptedAt), desc(messages.id))
    .limit(limit);

  return rows
    .map((row): TranslationContextTurn => ({
      messageId: row.messageId,
      role: row.direction === "customer_to_operator" ? "customer" : "operator",
      englishText: row.englishText ?? "",
      acceptedAt: row.acceptedAt,
    }))
    .reverse();
}

export async function listCustomerMessages(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
    readonly threadId: ThreadId;
    readonly after?: Cursor;
    readonly limit?: number;
  },
): Promise<ListMessagesResponseV1> {
  const after = parseCursor(input.after ?? "0");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const fetched = await db
    .select({
      cursor: customerTranscriptEntries.rowId,
      eventKind: customerTranscriptEntries.eventKind,
      message: messages,
    })
    .from(customerTranscriptEntries)
    .innerJoin(
      messages,
      and(
        eq(messages.id, customerTranscriptEntries.messageId),
        eq(messages.workspaceId, customerTranscriptEntries.workspaceId),
        eq(messages.inboxId, customerTranscriptEntries.inboxId),
        eq(messages.threadId, customerTranscriptEntries.threadId),
      ),
    )
    .where(
      and(
        eq(customerTranscriptEntries.workspaceId, input.workspaceId),
        eq(customerTranscriptEntries.inboxId, input.inboxId),
        eq(customerTranscriptEntries.threadId, input.threadId),
        gt(customerTranscriptEntries.rowId, after),
      ),
    )
    .orderBy(asc(customerTranscriptEntries.rowId))
    .limit(limit + 1);

  const page = fetched.slice(0, limit);
  const nextCursor = String(page.at(-1)?.cursor ?? after) as Cursor;
  const projected = page.map(({ eventKind, message }) => ({
    ...toCustomerMessageV1(message),
    state: eventKind,
  }));

  return {
    threadId: input.threadId,
    messages: sortMessagesForDisplay(projected),
    nextCursor,
    hasMore: fetched.length > limit,
  };
}

function parseCursor(cursor: Cursor): number {
  const parsed = Number(cursor);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError("Message cursor is outside the supported integer range");
  }

  return parsed;
}

/** Projects one canonical visible row into the public customer protocol. */
export function toCustomerMessageV1(message: MessageRow): MessageV1 {
  if (!message.customerVisibleText) {
    throw new MessageStateConflictError(message.id, "be projected to a customer DTO");
  }

  return {
    id: message.id,
    threadId: message.threadId,
    ...(message.clientMessageId == null ? {} : { clientMessageId: message.clientMessageId }),
    direction: message.direction,
    text: message.customerVisibleText,
    ...(message.customerVisibleLanguage == null
      ? {}
      : { language: message.customerVisibleLanguage }),
    acceptedAt: message.acceptedAt.toISOString(),
    state: toCustomerMessageState(message),
  };
}
