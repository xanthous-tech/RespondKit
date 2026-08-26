import {
  acceptCustomerIngress,
  findThreadById,
  loadEnglishTranslationContext,
  markCustomerMessageProjected,
  markOperatorAuditProjected,
  publishOperatorReply,
  recordTerminalFailure,
  reopenMessageForRetry,
  storeCustomerTranslation,
  type MessageFailureStage,
} from "@agent-chat/conversations";
import {
  DiscordRestClient,
  DiscordRestError,
  acceptReplyIngress,
  beginDiscordProjection,
  claimDiscordThread,
  createDiscordCorrelationMarker,
  createDiscordNonce,
  finalizeDiscordThreadClaim,
  findDiscordIntegrationForInbox,
  findDiscordThread,
  markDiscordProjectionFailed,
  markDiscordProjectionSent,
  splitDiscordMessage,
  type DiscordProjectionKind,
} from "@agent-chat/discord";
import {
  TranslationError,
  classifyTranslationError,
  createGeminiTranslationModel,
  createTranslator,
  type TranslationResult,
} from "@agent-chat/translation";
import { findInboxById } from "@agent-chat/workspaces";
import {
  WorkflowEntrypoint,
  type WorkflowDynamicDelayContext,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { createDatabase } from "../db";
import type { Env } from "../env";
import { translationRecordId } from "../identity";
import { messageWorkflowEnvelopeSchema, type MessageWorkflowEnvelope } from "./envelope";

const DATABASE_STEP = {
  retries: { limit: 3, delay: "1 second", backoff: "exponential" },
  timeout: "30 seconds",
} as const;

const TRANSLATION_STEP = {
  retries: { limit: 4, delay: "2 seconds", backoff: "exponential" },
  timeout: "2 minutes",
} as const;

const DISCORD_STEP = {
  retries: {
    limit: 5,
    delay: ({ ctx, error }: WorkflowDynamicDelayContext) => {
      if (error instanceof DiscordRestError && error.retryAfterMs !== undefined) {
        return error.retryAfterMs;
      }
      return Math.min(2_000 * 2 ** Math.max(0, ctx.attempt - 1), 30_000);
    },
    // Discord retry_after is already an exact delay. Other transient failures
    // get bounded exponential delay from the function above.
    backoff: "constant",
  },
  timeout: "1 minute",
} as const;

const DISCORD_THREAD_CLAIM_LEASE_MS = 2 * 60 * 1_000;

interface PersistedIngress {
  readonly generation: number;
  readonly alreadySucceeded: boolean;
}

interface TranslationContextResult {
  readonly generation: number;
  readonly targetLanguage: string;
  readonly turns: readonly {
    readonly role: "customer" | "operator";
    readonly text: string;
  }[];
}

interface CanonicalTranslationResult {
  readonly sourceLanguage: string;
  readonly targetLanguage: string;
  readonly translatedText: string;
  readonly mixedLanguage: boolean;
  readonly needsReview: boolean;
}

interface DiscordIntegrationResult {
  readonly id: string;
  readonly applicationId: string;
  readonly guildId: string;
  readonly forumChannelId: string;
}

interface ReadyDiscordThread {
  readonly integration: DiscordIntegrationResult;
  readonly discordThreadId: string;
}

function database(env: Env) {
  return createDatabase(env.DB);
}

function permanent(error: unknown, operation: string): never {
  const message = error instanceof Error ? error.message : String(error);
  throw new NonRetryableError(`${operation}: ${message.slice(0, 400)}`);
}

function throwDatabaseError(error: unknown, operation: string): never {
  if (error instanceof Error && /(?:Conflict|Identity)Error$/.test(error.name)) {
    permanent(error, operation);
  }
  throw error;
}

function throwTranslationError(error: unknown): never {
  const classified = classifyTranslationError(error);
  if (!classified.retryable) permanent(classified, `translation/${classified.code}`);
  throw classified;
}

async function discordOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DiscordRestError && !error.retryable) {
      permanent(error, `discord/${error.status ?? "configuration"}`);
    }
    throw error;
  }
}

function failureCode(error: unknown): string {
  if (error instanceof TranslationError) return `translation_${error.code}`.slice(0, 128);
  if (error instanceof DiscordRestError) {
    return `discord_${error.status ?? "network"}_${error.discordCode ?? "unknown"}`.slice(0, 128);
  }
  if (error instanceof Error && error.name.length > 0) {
    return error.name.replaceAll(/[^A-Za-z0-9_-]/g, "_").slice(0, 128);
  }
  return "unknown_failure";
}

function discordClient(env: Env): DiscordRestClient {
  return new DiscordRestClient({
    botToken: env.DISCORD_BOT_TOKEN,
    baseUrl: env.DISCORD_API_BASE_URL,
    userAgent: "AgentChat (https://github.com/lhr0909/agent-chat, 0.1)",
  });
}

function safeThreadName(envelope: MessageWorkflowEnvelope): string {
  const identity =
    envelope.direction === "customer_to_operator"
      ? (envelope.context.email ?? envelope.context.externalUserId)
      : undefined;
  const raw =
    identity === undefined ? `Support ${envelope.threadId.slice(-12)}` : `Support · ${identity}`;
  const normalized = raw.replaceAll(/\s+/g, " ").trim();
  let bounded = (normalized.length === 0 ? "Support" : normalized).slice(0, 100);
  const lastCodeUnit = bounded.charCodeAt(bounded.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) bounded = bounded.slice(0, -1);
  return bounded;
}

function starterContent(envelope: MessageWorkflowEnvelope, marker: string): string {
  const lines = [
    "**New Agent Chat support conversation**",
    `Inbox: \`${envelope.inboxId}\``,
    `Thread: \`${envelope.threadId}\``,
    envelope.direction === "customer_to_operator" && envelope.context.email !== undefined
      ? `Email: ${envelope.context.email}`
      : undefined,
    envelope.direction === "customer_to_operator" && envelope.context.externalUserId !== undefined
      ? `User: \`${envelope.context.externalUserId}\``
      : undefined,
    envelope.direction === "customer_to_operator" &&
    envelope.context.posthogDistinctId !== undefined
      ? `PostHog: \`${envelope.context.posthogDistinctId}\``
      : undefined,
    envelope.direction === "customer_to_operator" && envelope.context.locale !== undefined
      ? `Locale: ${envelope.context.locale}`
      : undefined,
    envelope.direction === "customer_to_operator" && envelope.context.timezone !== undefined
      ? `Timezone: ${envelope.context.timezone}`
      : undefined,
    envelope.direction === "customer_to_operator" && envelope.context.region !== undefined
      ? `Region: ${envelope.context.region}`
      : undefined,
    envelope.direction === "customer_to_operator" && envelope.context.userAgent !== undefined
      ? `Device: ${envelope.context.userAgent}`
      : undefined,
  ].filter((line): line is string => line !== undefined);
  const maximumPrefixLength = 2_000 - marker.length - 1;
  let prefix = lines.join("\n").slice(0, maximumPrefixLength);
  const lastCodeUnit = prefix.charCodeAt(prefix.length - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) prefix = prefix.slice(0, -1);
  return `${prefix}\n${marker}`;
}

async function persistIngress(
  env: Env,
  envelope: MessageWorkflowEnvelope,
): Promise<PersistedIngress> {
  const db = database(env);
  try {
    const acceptance =
      envelope.direction === "customer_to_operator"
        ? await acceptCustomerIngress(db, {
            id: envelope.messageId,
            workspaceId: envelope.workspaceId,
            inboxId: envelope.inboxId,
            threadId: envelope.threadId,
            clientMessageId: envelope.clientMessageId,
            workflowInstanceId: envelope.workflowInstanceId,
            acceptedAt: new Date(envelope.acceptedAt),
            originalText: envelope.originalText,
            ...(envelope.localeHint === undefined ? {} : { localeHint: envelope.localeHint }),
          })
        : await acceptReplyIngress(db, {
            integrationId: envelope.discord.integrationId,
            interactionId: envelope.discord.interactionId,
            workspaceId: envelope.workspaceId,
            inboxId: envelope.inboxId,
            threadId: envelope.threadId,
            messageId: envelope.messageId,
            workflowInstanceId: envelope.workflowInstanceId,
            applicationId: envelope.discord.applicationId,
            guildId: envelope.discord.guildId,
            discordThreadId: envelope.discord.threadId,
            operatorUserId: envelope.discord.operatorId,
            operatorRoleIds: envelope.discord.operatorRoleIds,
            acceptedAt: new Date(envelope.acceptedAt),
            originalEnglishText: envelope.originalText,
          });

    if (!acceptance.immutablePayloadMatches) {
      permanent(new Error("the first accepted immutable payload differs"), "persist ingress");
    }
    if (acceptance.kind === "already_succeeded") {
      return {
        generation: acceptance.message.processingGeneration,
        alreadySucceeded: true,
      };
    }
    if (acceptance.kind === "already_failed") {
      const reopened = await reopenMessageForRetry(db, {
        workspaceId: envelope.workspaceId,
        inboxId: envelope.inboxId,
        threadId: envelope.threadId,
        messageId: envelope.messageId,
        generation: acceptance.message.processingGeneration,
        reopenedAt: new Date(),
        requireCustomerUnavailable: envelope.direction === "operator_to_customer",
      });
      return { generation: reopened.processingGeneration, alreadySucceeded: false };
    }
    return {
      generation: acceptance.message.processingGeneration,
      alreadySucceeded: false,
    };
  } catch (error) {
    throwDatabaseError(error, "persist ingress");
  }
}

async function loadTranslationContext(
  env: Env,
  envelope: MessageWorkflowEnvelope,
  generation: number,
): Promise<TranslationContextResult> {
  const db = database(env);
  const [thread, inbox, turns] = await Promise.all([
    findThreadById(db, {
      workspaceId: envelope.workspaceId,
      inboxId: envelope.inboxId,
      threadId: envelope.threadId,
    }),
    findInboxById(db, envelope.workspaceId, envelope.inboxId),
    loadEnglishTranslationContext(db, {
      workspaceId: envelope.workspaceId,
      inboxId: envelope.inboxId,
      threadId: envelope.threadId,
      before: new Date(envelope.acceptedAt),
      limit: 20,
    }),
  ]);
  if (thread === null || inbox === null) {
    permanent(new Error("thread or inbox is unavailable"), "load translation context");
  }
  return {
    generation,
    targetLanguage:
      envelope.direction === "customer_to_operator"
        ? "en"
        : (thread.customerLanguage ?? inbox.defaultLocale ?? "en"),
    turns: turns.map((turn) => ({ role: turn.role, text: turn.englishText })),
  };
}

async function translate(
  env: Env,
  envelope: MessageWorkflowEnvelope,
  context: TranslationContextResult,
): Promise<TranslationResult> {
  try {
    const translator = createTranslator({
      model: createGeminiTranslationModel({
        apiKey: env.GEMINI_API_KEY,
        modelId: env.GEMINI_MODEL,
      }),
    });
    const input = {
      text: envelope.originalText,
      targetLanguage: context.targetLanguage,
      context: context.turns,
    };
    if (envelope.direction === "operator_to_customer") {
      return await translator.translate({ ...input, sourceLanguage: "en" });
    }
    // Browser locale is useful operator context, but it is not proof of the
    // language used in this message. Gemini must detect incoming language or
    // an English-configured browser could incorrectly pass Thai/Burmese through.
    return await translator.translate(input);
  } catch (error) {
    throwTranslationError(error);
  }
}

async function storeTranslation(
  env: Env,
  envelope: MessageWorkflowEnvelope,
  generation: number,
  result: TranslationResult,
) {
  const input = {
    id: translationRecordId(envelope.messageId, result.targetLanguage, result.promptVersion),
    workspaceId: envelope.workspaceId,
    inboxId: envelope.inboxId,
    threadId: envelope.threadId,
    messageId: envelope.messageId,
    generation,
    sourceLanguage: result.sourceLanguage,
    targetLanguage: result.targetLanguage,
    translatedText: result.translatedText,
    promptVersion: result.promptVersion,
    provider: result.provider,
    model: result.modelId,
    isPassThrough: result.passThrough,
    mixedLanguage: result.mixedLanguage,
    needsReview: result.needsReview,
    translatedAt: new Date(),
  };
  try {
    const stored =
      envelope.direction === "customer_to_operator"
        ? await storeCustomerTranslation(database(env), input)
        : await publishOperatorReply(database(env), input);
    return {
      sourceLanguage: stored.translation.sourceLanguage,
      targetLanguage: stored.translation.targetLanguage,
      translatedText: stored.translation.translatedText,
      mixedLanguage: stored.translation.mixedLanguage,
      needsReview: stored.translation.needsReview,
    } satisfies CanonicalTranslationResult;
  } catch (error) {
    throwDatabaseError(error, "store translation");
  }
}

async function ensureDiscordThread(
  step: WorkflowStep,
  env: Env,
  envelope: MessageWorkflowEnvelope,
  prefix = "discord",
): Promise<ReadyDiscordThread> {
  const integration = await step.do(
    `${prefix}-load-integration`,
    DATABASE_STEP,
    async (): Promise<DiscordIntegrationResult> => {
      const found = await findDiscordIntegrationForInbox(database(env), {
        workspaceId: envelope.workspaceId,
        inboxId: envelope.inboxId,
      });
      if (found === null) {
        permanent(new Error("no Discord integration is configured"), "load Discord integration");
      }
      return {
        id: found.id,
        applicationId: found.applicationId,
        guildId: found.guildId,
        forumChannelId: found.forumChannelId,
      };
    },
  );

  const correlationMarker = createDiscordCorrelationMarker(envelope.threadId);
  const claim = await step.do(`${prefix}-claim-thread`, DISCORD_STEP, async () => {
    const claimed = await claimDiscordThread(database(env), {
      integrationId: integration.id,
      workspaceId: envelope.workspaceId,
      inboxId: envelope.inboxId,
      threadId: envelope.threadId,
      correlationMarker,
      claimOwner: envelope.workflowInstanceId,
      now: new Date(),
      claimExpiresAt: new Date(Date.now() + DISCORD_THREAD_CLAIM_LEASE_MS),
    });
    if (claimed.kind === "contended") {
      throw new Error("another Workflow currently owns the Discord thread claim");
    }
    return {
      kind: claimed.kind,
      discordThreadId: claimed.thread.discordThreadId,
    };
  });
  if (claim.kind === "ready" && claim.discordThreadId !== null) {
    return { integration, discordThreadId: claim.discordThreadId };
  }

  const created = await step.do(`${prefix}-create-or-reconcile-thread`, DISCORD_STEP, async () => {
    const now = new Date();
    const attemptClaim = await claimDiscordThread(database(env), {
      integrationId: integration.id,
      workspaceId: envelope.workspaceId,
      inboxId: envelope.inboxId,
      threadId: envelope.threadId,
      correlationMarker,
      claimOwner: envelope.workflowInstanceId,
      now,
      claimExpiresAt: new Date(now.getTime() + DISCORD_THREAD_CLAIM_LEASE_MS),
    });
    if (attemptClaim.kind === "contended") {
      throw new Error("another Workflow currently owns the Discord thread claim");
    }
    if (attemptClaim.kind === "ready" && attemptClaim.thread.discordThreadId !== null) {
      return { discordThreadId: attemptClaim.thread.discordThreadId };
    }

    try {
      return await discordOperation(async () => {
        const result = await discordClient(env).createForumThreadReconciled({
          guildId: integration.guildId,
          forumChannelId: integration.forumChannelId,
          name: safeThreadName(envelope),
          starterContent: starterContent(envelope, correlationMarker),
          correlationMarker,
        });
        if (result.thread.id.length === 0) {
          permanent(new Error("missing thread ID"), "Discord create");
        }
        return { discordThreadId: result.thread.id };
      });
    } catch (error) {
      if (!(error instanceof NonRetryableError)) {
        const failedAt = new Date();
        const retryAfterMs = error instanceof DiscordRestError ? (error.retryAfterMs ?? 0) : 0;
        await claimDiscordThread(database(env), {
          integrationId: integration.id,
          workspaceId: envelope.workspaceId,
          inboxId: envelope.inboxId,
          threadId: envelope.threadId,
          correlationMarker,
          claimOwner: envelope.workflowInstanceId,
          now: failedAt,
          claimExpiresAt: new Date(
            failedAt.getTime() + DISCORD_THREAD_CLAIM_LEASE_MS + retryAfterMs,
          ),
        });
      }
      throw error;
    }
  });

  const finalized = await step.do(`${prefix}-finalize-thread`, DATABASE_STEP, async () => {
    const result = await finalizeDiscordThreadClaim(database(env), {
      workspaceId: envelope.workspaceId,
      inboxId: envelope.inboxId,
      threadId: envelope.threadId,
      integrationId: integration.id,
      correlationMarker,
      claimOwner: envelope.workflowInstanceId,
      discordThreadId: created.discordThreadId,
      finalizedAt: new Date(),
    });
    if (result.kind !== "ready" || result.thread.discordThreadId === null) {
      throw new Error("Discord thread claim was lost during finalization");
    }
    return { discordThreadId: result.thread.discordThreadId };
  });
  return { integration, discordThreadId: finalized.discordThreadId };
}

async function loadReadyDiscordThread(
  env: Env,
  envelope: MessageWorkflowEnvelope,
): Promise<ReadyDiscordThread> {
  const [integration, mapping] = await Promise.all([
    findDiscordIntegrationForInbox(database(env), {
      workspaceId: envelope.workspaceId,
      inboxId: envelope.inboxId,
    }),
    findDiscordThread(database(env), {
      workspaceId: envelope.workspaceId,
      inboxId: envelope.inboxId,
      threadId: envelope.threadId,
    }),
  ]);
  if (
    integration === null ||
    mapping === null ||
    mapping.state !== "ready" ||
    mapping.discordThreadId === null ||
    mapping.integrationId !== integration.id
  ) {
    permanent(new Error("Discord thread mapping is unavailable"), "load Discord thread");
  }
  return {
    integration: {
      id: integration.id,
      applicationId: integration.applicationId,
      guildId: integration.guildId,
      forumChannelId: integration.forumChannelId,
    },
    discordThreadId: mapping.discordThreadId,
  };
}

async function projectDiscordChunks(
  step: WorkflowStep,
  env: Env,
  envelope: MessageWorkflowEnvelope,
  target: ReadyDiscordThread,
  projectionKind: DiscordProjectionKind,
  content: string,
  prefix: string,
) {
  const chunks = splitDiscordMessage(content);
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    if (chunk === undefined) continue;
    await step.do(`${prefix}-${chunkIndex}`, DISCORD_STEP, async () => {
      const identity = {
        workspaceId: envelope.workspaceId,
        inboxId: envelope.inboxId,
        threadId: envelope.threadId,
        messageId: envelope.messageId,
        projectionKind,
        chunkIndex,
      } as const;
      const nonce = createDiscordNonce(`${envelope.messageId}:${projectionKind}`, chunkIndex);
      const marker = createDiscordCorrelationMarker(
        `${envelope.messageId}:${projectionKind}:${chunkIndex}`,
      );
      const begun = await beginDiscordProjection(database(env), {
        ...identity,
        integrationId: target.integration.id,
        nonce,
        correlationMarker: marker,
        discordThreadId: target.discordThreadId,
        createdAt: new Date(),
      });
      if (begun.projection.status === "sent") {
        return { discordMessageId: begun.projection.discordMessageId };
      }

      try {
        const sent = await discordOperation(() =>
          discordClient(env).sendMessageReconciled({
            channelId: target.discordThreadId,
            content: chunk,
            nonce,
          }),
        );
        await markDiscordProjectionSent(database(env), {
          ...identity,
          discordMessageId: sent.message.id,
          sentAt: new Date(),
        });
        return { discordMessageId: sent.message.id };
      } catch (error) {
        await markDiscordProjectionFailed(database(env), {
          ...identity,
          errorCode: failureCode(error),
          failedAt: new Date(),
        });
        throw error;
      }
    });
  }
}

function customerProjectionContent(
  envelope: MessageWorkflowEnvelope & { readonly direction: "customer_to_operator" },
  translation: CanonicalTranslationResult,
): string {
  return [
    `**Customer · ${translation.sourceLanguage} → English**`,
    translation.needsReview
      ? "⚠️ **Translation needs review.** Check the original message before acting."
      : undefined,
    translation.translatedText,
    "",
    `**Original (${translation.sourceLanguage})**`,
    envelope.originalText,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function availableAuditContent(translation: CanonicalTranslationResult): string {
  return [
    `**Available in chat · ${translation.targetLanguage}**`,
    translation.needsReview
      ? "⚠️ **Translation needs review.** Check the customer-facing text."
      : undefined,
    translation.translatedText,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function failureAuditContent(
  envelope: MessageWorkflowEnvelope,
  stage: MessageFailureStage,
): string {
  if (envelope.direction === "operator_to_customer" && stage === "discord_audit") {
    return "**Available in chat, but the Discord audit failed.** The customer-facing reply remains available; do not resend it.";
  }
  return envelope.direction === "operator_to_customer"
    ? [
        "**Processing failed** — the reply was not made available in chat.",
        "",
        "**English reply**",
        envelope.originalText,
      ].join("\n")
    : [
        "**Processing failed** — the customer message needs investigation.",
        "",
        "**Original customer message**",
        envelope.originalText,
      ].join("\n");
}

async function finalizeSuccess(env: Env, envelope: MessageWorkflowEnvelope, generation: number) {
  const transition = {
    workspaceId: envelope.workspaceId,
    inboxId: envelope.inboxId,
    threadId: envelope.threadId,
    messageId: envelope.messageId,
    generation,
    transitionedAt: new Date(),
  };
  return envelope.direction === "customer_to_operator"
    ? markCustomerMessageProjected(database(env), transition)
    : markOperatorAuditProjected(database(env), transition);
}

async function recordFailure(
  env: Env,
  envelope: MessageWorkflowEnvelope,
  generation: number,
  stage: MessageFailureStage,
  error: unknown,
) {
  return recordTerminalFailure(database(env), {
    workspaceId: envelope.workspaceId,
    inboxId: envelope.inboxId,
    threadId: envelope.threadId,
    messageId: envelope.messageId,
    generation,
    transitionedAt: new Date(),
    stage,
    failureCode: failureCode(error),
  });
}

export class MessageWorkflow extends WorkflowEntrypoint<Env, MessageWorkflowEnvelope> {
  override async run(event: WorkflowEvent<MessageWorkflowEnvelope>, step: WorkflowStep) {
    const envelope = messageWorkflowEnvelopeSchema.parse(event.payload);
    let generation = 1;
    let stage: MessageFailureStage = "ingress";

    try {
      const persisted = await step.do("persist-ingress", DATABASE_STEP, () =>
        persistIngress(this.env, envelope),
      );
      generation = persisted.generation;
      if (persisted.alreadySucceeded) {
        return { messageId: envelope.messageId, status: "already_succeeded" };
      }

      stage = "translation";
      const context = await step.do("load-translation-context", DATABASE_STEP, () =>
        loadTranslationContext(this.env, envelope, generation),
      );
      const translation = await step.do("translate-message", TRANSLATION_STEP, () =>
        translate(this.env, envelope, context),
      );

      stage = "publish";
      const canonicalTranslation = await step.do("store-translation", DATABASE_STEP, () =>
        storeTranslation(this.env, envelope, generation, translation),
      );

      if (envelope.direction === "customer_to_operator") {
        stage = "discord_thread";
        const target = await ensureDiscordThread(step, this.env, envelope);
        stage = "discord_projection";
        await projectDiscordChunks(
          step,
          this.env,
          envelope,
          target,
          "customer_projection",
          customerProjectionContent(envelope, canonicalTranslation),
          "project-customer-message",
        );
      } else {
        stage = "discord_audit";
        const target = await step.do("load-discord-thread", DATABASE_STEP, () =>
          loadReadyDiscordThread(this.env, envelope),
        );
        await projectDiscordChunks(
          step,
          this.env,
          envelope,
          target,
          "available_audit",
          availableAuditContent(canonicalTranslation),
          "post-available-audit",
        );
      }

      await step.do("finalize-message", DATABASE_STEP, async () => {
        const message = await finalizeSuccess(this.env, envelope, generation);
        return { processingStatus: message.processingStatus };
      });
      return { messageId: envelope.messageId, status: "succeeded" };
    } catch (error) {
      try {
        await step.do("record-terminal-failure", DATABASE_STEP, async () => {
          const message = await recordFailure(this.env, envelope, generation, stage, error);
          return {
            processingStatus: message.processingStatus,
            customerAvailability: message.customerAvailability,
          };
        });
      } catch {
        // Ingress may have failed before a canonical message existed.
      }

      try {
        const target = await ensureDiscordThread(step, this.env, envelope, "failure-discord");
        await projectDiscordChunks(
          step,
          this.env,
          envelope,
          target,
          "failure_audit",
          failureAuditContent(envelope, stage),
          "post-failure-audit",
        );
      } catch {
        // The D1 terminal state remains authoritative when best-effort audit fails.
      }
      throw error;
    }
  }
}
