import type {
  InboxId,
  MessageId,
  ThreadId,
  WorkflowInstanceId,
  WorkspaceId,
} from "@respondkit/protocol";
import {
  findMessageById,
  prepareOperatorMessageStatements,
  type IngressAcceptanceKind,
  type MessageRow,
} from "@respondkit/conversations";
import { and, eq, lte, ne, or } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import {
  discordIntegrations,
  discordInteractions,
  discordMessages,
  discordOperatorAllowlists,
  discordThreads,
  type DiscordIntegrationRow,
  type DiscordInteractionRow,
  type DiscordMessageRow,
  type DiscordProjectionKind,
  type DiscordThreadRow,
} from "./schema";

export interface DiscordReplyIngressInput {
  readonly integrationId: string;
  readonly interactionId: string;
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly workflowInstanceId: WorkflowInstanceId;
  readonly applicationId: string;
  readonly guildId: string;
  readonly discordThreadId: string;
  readonly operatorUserId: string;
  readonly operatorRoleIds: readonly string[];
  readonly acceptedAt: Date;
  readonly originalEnglishText: string;
}

export interface DiscordReplyIngressAcceptance {
  readonly kind: IngressAcceptanceKind;
  readonly immutablePayloadMatches: boolean;
  readonly interaction: DiscordInteractionRow;
  readonly message: MessageRow;
}

export class DiscordReplyIdentityConflictError extends Error {
  override readonly name = "DiscordReplyIdentityConflictError";

  constructor(interactionId: string) {
    super(`Discord interaction ${interactionId} conflicts with an existing reply identity`);
  }
}

export class DiscordPersistenceIdentityConflictError extends Error {
  override readonly name = "DiscordPersistenceIdentityConflictError";

  constructor(entity: string, identity: string) {
    super(`Discord ${entity} ${identity} conflicts with its canonical identity`);
  }
}

function canonicalRoleIds(roleIds: readonly string[]): readonly string[] {
  return [...new Set(roleIds)].sort();
}

function acceptanceKindFromMessage(message: MessageRow): IngressAcceptanceKind {
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

export async function findDiscordInteraction(
  db: DrizzleD1Database,
  input: Pick<
    DiscordReplyIngressInput,
    "inboxId" | "integrationId" | "interactionId" | "workspaceId"
  >,
): Promise<DiscordInteractionRow | null> {
  const [interaction] = await db
    .select()
    .from(discordInteractions)
    .where(
      and(
        eq(discordInteractions.integrationId, input.integrationId),
        eq(discordInteractions.interactionId, input.interactionId),
        eq(discordInteractions.workspaceId, input.workspaceId),
        eq(discordInteractions.inboxId, input.inboxId),
      ),
    )
    .limit(1);
  return interaction ?? null;
}

function loadCanonicalAcceptance(
  input: DiscordReplyIngressInput,
  interaction: DiscordInteractionRow,
  message: MessageRow,
  kind: IngressAcceptanceKind,
): DiscordReplyIngressAcceptance {
  if (interaction.messageId === null || interaction.commandName !== "reply") {
    throw new DiscordReplyIdentityConflictError(input.interactionId);
  }

  if (message.direction !== "operator_to_customer") {
    throw new DiscordReplyIdentityConflictError(input.interactionId);
  }

  const roleIds = canonicalRoleIds(input.operatorRoleIds);
  // acceptedAt is a server observation: the first stored value stays canonical,
  // but a later Workflow reconstruction must not change payload identity.
  const immutablePayloadMatches =
    interaction.integrationId === input.integrationId &&
    interaction.interactionId === input.interactionId &&
    interaction.workspaceId === input.workspaceId &&
    interaction.inboxId === input.inboxId &&
    interaction.threadId === input.threadId &&
    interaction.messageId === input.messageId &&
    interaction.applicationId === input.applicationId &&
    interaction.guildId === input.guildId &&
    interaction.discordThreadId === input.discordThreadId &&
    interaction.operatorUserId === input.operatorUserId &&
    JSON.stringify(interaction.operatorRoleIds) === JSON.stringify(roleIds) &&
    interaction.referenceInteractionId === null &&
    interaction.normalizedMessage === input.originalEnglishText &&
    message.id === input.messageId &&
    message.workflowInstanceId === input.workflowInstanceId &&
    message.originalText === input.originalEnglishText;

  return {
    kind,
    immutablePayloadMatches,
    interaction,
    message,
  };
}

/**
 * Atomically accepts a Discord /reply receipt, its English operator message,
 * and thread activity. The short-lived interaction token is deliberately not
 * part of this input or any persistence schema.
 */
export async function acceptReplyIngress(
  db: DrizzleD1Database,
  input: DiscordReplyIngressInput,
): Promise<DiscordReplyIngressAcceptance> {
  const existingInteraction = await findDiscordInteraction(db, input);
  if (existingInteraction !== null) {
    const existingMessage =
      existingInteraction.messageId === null
        ? null
        : await findMessageById(db, {
            workspaceId: existingInteraction.workspaceId,
            inboxId: existingInteraction.inboxId,
            threadId: existingInteraction.threadId,
            messageId: existingInteraction.messageId,
          });
    if (existingMessage === null) {
      throw new DiscordReplyIdentityConflictError(input.interactionId);
    }
    return loadCanonicalAcceptance(
      input,
      existingInteraction,
      existingMessage,
      acceptanceKindFromMessage(existingMessage),
    );
  }

  const [messageStatement, activityStatement] = prepareOperatorMessageStatements(db, {
    id: input.messageId,
    workspaceId: input.workspaceId,
    inboxId: input.inboxId,
    threadId: input.threadId,
    workflowInstanceId: input.workflowInstanceId,
    acceptedAt: input.acceptedAt,
    originalEnglishText: input.originalEnglishText,
  });
  const receiptStatement = db
    .insert(discordInteractions)
    .values({
      integrationId: input.integrationId,
      interactionId: input.interactionId,
      workspaceId: input.workspaceId,
      inboxId: input.inboxId,
      threadId: input.threadId,
      messageId: input.messageId,
      applicationId: input.applicationId,
      guildId: input.guildId,
      discordThreadId: input.discordThreadId,
      operatorUserId: input.operatorUserId,
      operatorRoleIds: canonicalRoleIds(input.operatorRoleIds),
      commandName: "reply",
      referenceInteractionId: null,
      normalizedMessage: input.originalEnglishText,
      acceptedAt: input.acceptedAt,
      createdAt: input.acceptedAt,
    })
    .onConflictDoNothing()
    .returning({ interactionId: discordInteractions.interactionId });

  const [insertedMessage, , insertedReceipt] = await db.batch([
    messageStatement,
    activityStatement,
    receiptStatement,
  ]);

  const canonicalInteraction = await findDiscordInteraction(db, input);
  if (canonicalInteraction === null) {
    throw new DiscordReplyIdentityConflictError(input.interactionId);
  }
  const canonicalMessage =
    canonicalInteraction.messageId === null
      ? null
      : await findMessageById(db, {
          workspaceId: canonicalInteraction.workspaceId,
          inboxId: canonicalInteraction.inboxId,
          threadId: canonicalInteraction.threadId,
          messageId: canonicalInteraction.messageId,
        });
  if (canonicalMessage === null) {
    throw new DiscordReplyIdentityConflictError(input.interactionId);
  }

  return loadCanonicalAcceptance(
    input,
    canonicalInteraction,
    canonicalMessage,
    insertedMessage.length > 0 && insertedReceipt.length > 0
      ? "inserted"
      : acceptanceKindFromMessage(canonicalMessage),
  );
}

export async function findDiscordIntegrationForInbox(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
  },
): Promise<DiscordIntegrationRow | null> {
  const [integration] = await db
    .select()
    .from(discordIntegrations)
    .where(
      and(
        eq(discordIntegrations.workspaceId, input.workspaceId),
        eq(discordIntegrations.inboxId, input.inboxId),
      ),
    )
    .limit(1);
  return integration ?? null;
}

export async function findDiscordReplyByReference(
  db: DrizzleD1Database,
  input: {
    readonly integrationId: string;
    readonly interactionId: string;
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
  },
): Promise<{
  readonly interaction: DiscordInteractionRow;
  readonly message: MessageRow;
} | null> {
  const interaction = await findDiscordInteraction(db, input);
  if (interaction === null) {
    return null;
  }
  if (interaction.commandName !== "reply" || interaction.messageId === null) {
    throw new DiscordPersistenceIdentityConflictError("interaction", input.interactionId);
  }
  const message = await findMessageById(db, {
    workspaceId: interaction.workspaceId,
    inboxId: interaction.inboxId,
    threadId: interaction.threadId,
    messageId: interaction.messageId,
  });
  if (message === null || message.direction !== "operator_to_customer") {
    throw new DiscordPersistenceIdentityConflictError("interaction", input.interactionId);
  }
  return { interaction, message };
}

export type ResolveAuthorizedDiscordThreadResult =
  | {
      readonly ok: true;
      readonly matchedBy: "role" | "user";
      readonly integration: DiscordIntegrationRow;
      readonly thread: DiscordThreadRow;
    }
  | {
      readonly ok: false;
      readonly reason: "operator_not_allowed" | "thread_not_mapped";
    };

export async function resolveAuthorizedDiscordThread(
  db: DrizzleD1Database,
  input: {
    readonly applicationId: string;
    readonly guildId: string;
    readonly forumChannelId: string;
    readonly discordThreadId: string;
    readonly operatorUserId: string;
    readonly operatorRoleIds: readonly string[];
  },
): Promise<ResolveAuthorizedDiscordThreadResult> {
  const [mapping] = await db
    .select({
      integration: discordIntegrations,
      thread: discordThreads,
    })
    .from(discordThreads)
    .innerJoin(
      discordIntegrations,
      and(
        eq(discordIntegrations.id, discordThreads.integrationId),
        eq(discordIntegrations.workspaceId, discordThreads.workspaceId),
        eq(discordIntegrations.inboxId, discordThreads.inboxId),
      ),
    )
    .where(
      and(
        eq(discordThreads.state, "ready"),
        eq(discordThreads.discordThreadId, input.discordThreadId),
        eq(discordIntegrations.applicationId, input.applicationId),
        eq(discordIntegrations.guildId, input.guildId),
        eq(discordIntegrations.forumChannelId, input.forumChannelId),
      ),
    )
    .limit(1);
  if (mapping === undefined) {
    return { ok: false, reason: "thread_not_mapped" };
  }

  const operators = await db
    .select({
      principalType: discordOperatorAllowlists.principalType,
      principalId: discordOperatorAllowlists.principalId,
    })
    .from(discordOperatorAllowlists)
    .where(
      and(
        eq(discordOperatorAllowlists.integrationId, mapping.integration.id),
        eq(discordOperatorAllowlists.workspaceId, mapping.integration.workspaceId),
      ),
    );
  if (
    operators.some(
      (operator) =>
        operator.principalType === "user" && operator.principalId === input.operatorUserId,
    )
  ) {
    return { ok: true, matchedBy: "user", ...mapping };
  }
  const roleIds = new Set(input.operatorRoleIds);
  if (
    operators.some(
      (operator) => operator.principalType === "role" && roleIds.has(operator.principalId),
    )
  ) {
    return { ok: true, matchedBy: "role", ...mapping };
  }
  return { ok: false, reason: "operator_not_allowed" };
}

export async function findDiscordThread(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
    readonly threadId: ThreadId;
  },
): Promise<DiscordThreadRow | null> {
  const [thread] = await db
    .select()
    .from(discordThreads)
    .where(
      and(
        eq(discordThreads.workspaceId, input.workspaceId),
        eq(discordThreads.inboxId, input.inboxId),
        eq(discordThreads.threadId, input.threadId),
      ),
    )
    .limit(1);
  return thread ?? null;
}

export interface ClaimDiscordThreadInput {
  readonly integrationId: string;
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly threadId: ThreadId;
  readonly correlationMarker: string;
  readonly claimOwner: string;
  readonly now: Date;
  readonly claimExpiresAt: Date;
}

export type ClaimDiscordThreadResult =
  | { readonly kind: "claimed"; readonly thread: DiscordThreadRow }
  | { readonly kind: "contended"; readonly thread: DiscordThreadRow }
  | { readonly kind: "ready"; readonly thread: DiscordThreadRow };

export async function claimDiscordThread(
  db: DrizzleD1Database,
  input: ClaimDiscordThreadInput,
): Promise<ClaimDiscordThreadResult> {
  if (input.claimExpiresAt.getTime() <= input.now.getTime()) {
    throw new RangeError("Discord thread claim expiry must be in the future");
  }
  await db
    .insert(discordThreads)
    .values({
      threadId: input.threadId,
      workspaceId: input.workspaceId,
      inboxId: input.inboxId,
      integrationId: input.integrationId,
      state: "claiming",
      claimOwner: input.claimOwner,
      claimExpiresAt: input.claimExpiresAt,
      correlationMarker: input.correlationMarker,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoNothing();

  await db
    .update(discordThreads)
    .set({
      claimOwner: input.claimOwner,
      claimExpiresAt: input.claimExpiresAt,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(discordThreads.workspaceId, input.workspaceId),
        eq(discordThreads.inboxId, input.inboxId),
        eq(discordThreads.threadId, input.threadId),
        eq(discordThreads.integrationId, input.integrationId),
        eq(discordThreads.state, "claiming"),
        eq(discordThreads.correlationMarker, input.correlationMarker),
        or(
          eq(discordThreads.claimOwner, input.claimOwner),
          lte(discordThreads.claimExpiresAt, input.now),
        ),
      ),
    );

  const canonical = await findDiscordThread(db, input);
  if (
    canonical === null ||
    canonical.integrationId !== input.integrationId ||
    canonical.correlationMarker !== input.correlationMarker
  ) {
    throw new DiscordPersistenceIdentityConflictError("thread", input.threadId);
  }
  if (canonical.state === "ready") {
    return { kind: "ready", thread: canonical };
  }
  return canonical.claimOwner === input.claimOwner
    ? { kind: "claimed", thread: canonical }
    : { kind: "contended", thread: canonical };
}

export async function renewDiscordThreadClaim(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
    readonly threadId: ThreadId;
    readonly integrationId: string;
    readonly correlationMarker: string;
    readonly claimOwner: string;
    readonly renewedAt: Date;
    readonly claimExpiresAt: Date;
  },
): Promise<DiscordThreadRow | null> {
  if (input.claimExpiresAt.getTime() <= input.renewedAt.getTime()) {
    throw new RangeError("Discord thread claim expiry must be after its renewal time");
  }
  const [thread] = await db
    .update(discordThreads)
    .set({
      claimExpiresAt: input.claimExpiresAt,
      updatedAt: input.renewedAt,
    })
    .where(
      and(
        eq(discordThreads.workspaceId, input.workspaceId),
        eq(discordThreads.inboxId, input.inboxId),
        eq(discordThreads.threadId, input.threadId),
        eq(discordThreads.integrationId, input.integrationId),
        eq(discordThreads.state, "claiming"),
        eq(discordThreads.correlationMarker, input.correlationMarker),
        eq(discordThreads.claimOwner, input.claimOwner),
      ),
    )
    .returning();
  return thread ?? null;
}

export type FinalizeDiscordThreadClaimResult =
  | { readonly kind: "claim_lost"; readonly thread: DiscordThreadRow }
  | { readonly kind: "ready"; readonly thread: DiscordThreadRow };

export async function finalizeDiscordThreadClaim(
  db: DrizzleD1Database,
  input: {
    readonly workspaceId: WorkspaceId;
    readonly inboxId: InboxId;
    readonly threadId: ThreadId;
    readonly integrationId: string;
    readonly correlationMarker: string;
    readonly claimOwner: string;
    readonly discordThreadId: string;
    readonly finalizedAt: Date;
  },
): Promise<FinalizeDiscordThreadClaimResult> {
  const [finalized] = await db
    .update(discordThreads)
    .set({
      state: "ready",
      discordThreadId: input.discordThreadId,
      claimOwner: null,
      claimExpiresAt: null,
      updatedAt: input.finalizedAt,
    })
    .where(
      and(
        eq(discordThreads.workspaceId, input.workspaceId),
        eq(discordThreads.inboxId, input.inboxId),
        eq(discordThreads.threadId, input.threadId),
        eq(discordThreads.integrationId, input.integrationId),
        eq(discordThreads.state, "claiming"),
        eq(discordThreads.correlationMarker, input.correlationMarker),
        eq(discordThreads.claimOwner, input.claimOwner),
      ),
    )
    .returning();
  if (finalized !== undefined) {
    return { kind: "ready", thread: finalized };
  }

  const canonical = await findDiscordThread(db, input);
  if (
    canonical === null ||
    canonical.integrationId !== input.integrationId ||
    canonical.correlationMarker !== input.correlationMarker
  ) {
    throw new DiscordPersistenceIdentityConflictError("thread", input.threadId);
  }
  if (canonical.state === "ready") {
    if (canonical.discordThreadId !== input.discordThreadId) {
      throw new DiscordPersistenceIdentityConflictError("thread", input.threadId);
    }
    return { kind: "ready", thread: canonical };
  }
  return { kind: "claim_lost", thread: canonical };
}

export interface DiscordProjectionIdentity {
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly projectionKind: DiscordProjectionKind;
  readonly chunkIndex: number;
}

export async function findDiscordProjection(
  db: DrizzleD1Database,
  input: DiscordProjectionIdentity,
): Promise<DiscordMessageRow | null> {
  const [projection] = await db
    .select()
    .from(discordMessages)
    .where(
      and(
        eq(discordMessages.workspaceId, input.workspaceId),
        eq(discordMessages.inboxId, input.inboxId),
        eq(discordMessages.threadId, input.threadId),
        eq(discordMessages.messageId, input.messageId),
        eq(discordMessages.projectionKind, input.projectionKind),
        eq(discordMessages.chunkIndex, input.chunkIndex),
      ),
    )
    .limit(1);
  return projection ?? null;
}

export interface BeginDiscordProjectionInput extends DiscordProjectionIdentity {
  readonly integrationId: string;
  readonly nonce: string;
  readonly correlationMarker: string;
  readonly discordThreadId: string;
  readonly createdAt: Date;
}

export async function beginDiscordProjection(
  db: DrizzleD1Database,
  input: BeginDiscordProjectionInput,
): Promise<{ readonly inserted: boolean; readonly projection: DiscordMessageRow }> {
  const inserted = await db
    .insert(discordMessages)
    .values({
      workspaceId: input.workspaceId,
      inboxId: input.inboxId,
      threadId: input.threadId,
      messageId: input.messageId,
      integrationId: input.integrationId,
      projectionKind: input.projectionKind,
      chunkIndex: input.chunkIndex,
      nonce: input.nonce,
      correlationMarker: input.correlationMarker,
      discordThreadId: input.discordThreadId,
      status: "pending",
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    .onConflictDoNothing()
    .returning({ messageId: discordMessages.messageId });
  const canonical = await findDiscordProjection(db, input);
  if (
    canonical === null ||
    canonical.integrationId !== input.integrationId ||
    canonical.nonce !== input.nonce ||
    canonical.correlationMarker !== input.correlationMarker ||
    canonical.discordThreadId !== input.discordThreadId
  ) {
    throw new DiscordPersistenceIdentityConflictError(
      "message projection",
      `${input.messageId}/${input.projectionKind}/${input.chunkIndex}`,
    );
  }
  return { inserted: inserted.length > 0, projection: canonical };
}

export async function markDiscordProjectionSent(
  db: DrizzleD1Database,
  input: DiscordProjectionIdentity & {
    readonly discordMessageId: string;
    readonly sentAt: Date;
  },
): Promise<DiscordMessageRow> {
  const [sent] = await db
    .update(discordMessages)
    .set({
      discordMessageId: input.discordMessageId,
      status: "sent",
      lastErrorCode: null,
      updatedAt: input.sentAt,
    })
    .where(
      and(
        eq(discordMessages.workspaceId, input.workspaceId),
        eq(discordMessages.inboxId, input.inboxId),
        eq(discordMessages.threadId, input.threadId),
        eq(discordMessages.messageId, input.messageId),
        eq(discordMessages.projectionKind, input.projectionKind),
        eq(discordMessages.chunkIndex, input.chunkIndex),
        ne(discordMessages.status, "sent"),
      ),
    )
    .returning();
  if (sent !== undefined) {
    return sent;
  }
  const canonical = await findDiscordProjection(db, input);
  if (
    canonical === null ||
    canonical.status !== "sent" ||
    canonical.discordMessageId !== input.discordMessageId
  ) {
    throw new DiscordPersistenceIdentityConflictError(
      "message projection",
      `${input.messageId}/${input.projectionKind}/${input.chunkIndex}`,
    );
  }
  return canonical;
}

export async function markDiscordProjectionFailed(
  db: DrizzleD1Database,
  input: DiscordProjectionIdentity & {
    readonly errorCode: string;
    readonly failedAt: Date;
  },
): Promise<DiscordMessageRow> {
  const [failed] = await db
    .update(discordMessages)
    .set({
      status: "failed",
      lastErrorCode: input.errorCode,
      updatedAt: input.failedAt,
    })
    .where(
      and(
        eq(discordMessages.workspaceId, input.workspaceId),
        eq(discordMessages.inboxId, input.inboxId),
        eq(discordMessages.threadId, input.threadId),
        eq(discordMessages.messageId, input.messageId),
        eq(discordMessages.projectionKind, input.projectionKind),
        eq(discordMessages.chunkIndex, input.chunkIndex),
        ne(discordMessages.status, "sent"),
      ),
    )
    .returning();
  if (failed !== undefined) {
    return failed;
  }
  const canonical = await findDiscordProjection(db, input);
  if (canonical === null) {
    throw new DiscordPersistenceIdentityConflictError(
      "message projection",
      `${input.messageId}/${input.projectionKind}/${input.chunkIndex}`,
    );
  }
  return canonical;
}

interface DiscordRecoveryInteractionBase {
  readonly integrationId: string;
  readonly interactionId: string;
  readonly workspaceId: WorkspaceId;
  readonly inboxId: InboxId;
  readonly threadId: ThreadId;
  readonly applicationId: string;
  readonly guildId: string;
  readonly discordThreadId: string;
  readonly operatorUserId: string;
  readonly operatorRoleIds: readonly string[];
  readonly referenceInteractionId: string;
  readonly acceptedAt: Date;
}

export type DiscordRecoveryInteractionInput =
  | (DiscordRecoveryInteractionBase & {
      readonly commandName: "status";
    })
  | (DiscordRecoveryInteractionBase & {
      readonly commandName: "retry";
      readonly originalEnglishText: string;
    });

export async function recordRecoveryInteraction(
  db: DrizzleD1Database,
  input: DiscordRecoveryInteractionInput,
): Promise<{
  readonly inserted: boolean;
  readonly immutablePayloadMatches: boolean;
  readonly interaction: DiscordInteractionRow;
}> {
  const normalizedMessage = input.commandName === "retry" ? input.originalEnglishText : null;
  const inserted = await db
    .insert(discordInteractions)
    .values({
      integrationId: input.integrationId,
      interactionId: input.interactionId,
      workspaceId: input.workspaceId,
      inboxId: input.inboxId,
      threadId: input.threadId,
      messageId: null,
      applicationId: input.applicationId,
      guildId: input.guildId,
      discordThreadId: input.discordThreadId,
      operatorUserId: input.operatorUserId,
      operatorRoleIds: canonicalRoleIds(input.operatorRoleIds),
      commandName: input.commandName,
      referenceInteractionId: input.referenceInteractionId,
      normalizedMessage,
      acceptedAt: input.acceptedAt,
      createdAt: input.acceptedAt,
    })
    .onConflictDoNothing()
    .returning({ interactionId: discordInteractions.interactionId });
  const canonical = await findDiscordInteraction(db, input);
  if (canonical === null || canonical.commandName === "reply") {
    throw new DiscordPersistenceIdentityConflictError("interaction", input.interactionId);
  }
  const roleIds = canonicalRoleIds(input.operatorRoleIds);
  return {
    inserted: inserted.length > 0,
    // Return the first acceptedAt above, but exclude that observation from identity.
    immutablePayloadMatches:
      canonical.commandName === input.commandName &&
      canonical.threadId === input.threadId &&
      canonical.applicationId === input.applicationId &&
      canonical.guildId === input.guildId &&
      canonical.discordThreadId === input.discordThreadId &&
      canonical.operatorUserId === input.operatorUserId &&
      JSON.stringify(canonical.operatorRoleIds) === JSON.stringify(roleIds) &&
      canonical.referenceInteractionId === input.referenceInteractionId &&
      canonical.normalizedMessage === normalizedMessage,
    interaction: canonical,
  };
}
