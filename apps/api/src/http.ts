import {
  createThread,
  findCustomerMessageByClientId,
  findThreadById,
  listCustomerMessages,
  toCustomerMessageV1,
  toMessageBusinessStatus,
  type MessageRow,
  type ThreadRow,
} from "@respondkit/conversations";
import {
  DISCORD_PONG_RESPONSE,
  DiscordChannelType,
  DiscordInteractionParseError,
  createEphemeralInteractionResponse,
  findDiscordReplyByReference,
  normalizeDiscordCommand,
  parseDiscordInteraction,
  recordRecoveryInteraction,
  resolveAuthorizedDiscordThread,
  verifyDiscordSignature,
  type ParsedDiscordCommandInteraction,
} from "@respondkit/discord";
import {
  ApiErrorResponseV1Schema,
  CreateClientSessionRequestV1Schema,
  CreateThreadRequestV1Schema,
  ListMessagesQueryV1Schema,
  SendMessageRequestV1Schema,
  deriveCustomerMessageIdentity,
  type ApiErrorCode,
  type MessageAcceptanceV1,
} from "@respondkit/protocol";
import {
  findInboxById,
  findInboxByPublicId,
  findVisitorById,
  isOriginAllowed,
  normalizeOrigin,
  upsertVisitor,
  type InboxContext,
  type VisitorRow,
} from "@respondkit/workspaces";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { createDatabase } from "./db";
import type { Env } from "./env";
import {
  createClientSessionId,
  deriveOperatorMessageIdentity,
  deriveThreadId,
  deriveVisitorId,
  discordInteractionAcceptedAt,
} from "./identity";
import {
  createAnonymousSession,
  readBearerToken,
  verifyAnonymousSession,
  type AnonymousSessionClaims,
} from "./session";
import {
  acceptWorkflow,
  isActiveWorkflow,
  workflowStatus,
  type WorkflowAcceptance,
  type WorkflowStatusSnapshot,
} from "./workflow-binding";
import type { MessageWorkflowEnvelope } from "./workflows/envelope";

type ApiStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;
type ApiVariables = { corsOrigin?: string };
type ApiContext = Context<{ Bindings: Env; Variables: ApiVariables }>;
const DISCORD_RESPONSE_CUTOFF_MS = 2_200;

class ApiHttpError extends Error {
  constructor(
    readonly status: ApiStatus,
    readonly code: ApiErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

async function beforeDiscordResponseCutoff<T>(
  operation: Promise<T>,
  requestStartedAt: number,
): Promise<T | "cutoff"> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const cutoff = new Promise<"cutoff">((resolve) => {
    timeoutId = setTimeout(
      () => resolve("cutoff"),
      Math.max(0, DISCORD_RESPONSE_CUTOFF_MS - (Date.now() - requestStartedAt)),
    );
  });
  try {
    return await Promise.race([operation, cutoff]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function applyCorsHeaders(context: ApiContext): void {
  const origin = context.get("corsOrigin");
  if (origin === undefined) return;
  context.header("access-control-allow-origin", origin);
  context.header("access-control-allow-headers", "authorization, content-type");
  context.header("access-control-allow-methods", "GET, POST, OPTIONS");
  context.header("access-control-max-age", "86400");
  context.header("vary", "Origin");
}

function apiError(context: ApiContext, error: ApiHttpError) {
  return context.json(
    ApiErrorResponseV1Schema.parse({
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    }),
    error.status,
  );
}

function requestOrigin(context: ApiContext): string {
  const value = context.req.header("origin");
  if (value === undefined) {
    throw new ApiHttpError(403, "forbidden", "An Origin header is required");
  }
  try {
    return normalizeOrigin(value);
  } catch {
    throw new ApiHttpError(403, "forbidden", "The request Origin is invalid");
  }
}

async function requireAllowedOrigin(
  context: ApiContext,
  inbox: Pick<InboxContext, "inboxId" | "workspaceId">,
): Promise<string> {
  const origin = requestOrigin(context);
  const allowed = await isOriginAllowed(createDatabase(context.env.DB), {
    workspaceId: inbox.workspaceId,
    inboxId: inbox.inboxId,
    origin,
  });
  if (!allowed) {
    throw new ApiHttpError(403, "forbidden", "This Origin is not allowed for the inbox");
  }
  context.set("corsOrigin", origin);
  return origin;
}

interface CustomerRequestAuth {
  readonly claims: AnonymousSessionClaims;
  readonly inbox: InboxContext;
  readonly visitor: VisitorRow;
}

async function authenticateCustomer(context: ApiContext): Promise<CustomerRequestAuth> {
  const token = readBearerToken(context.req.header("authorization"));
  if (token === null) {
    throw new ApiHttpError(401, "unauthorized", "A valid customer session is required");
  }
  const claims = await verifyAnonymousSession({
    signingKey: context.env.SESSION_SIGNING_KEY,
    token,
  });
  if (claims === null) {
    throw new ApiHttpError(401, "unauthorized", "The customer session is invalid or expired");
  }

  const db = createDatabase(context.env.DB);
  const inbox = await findInboxById(db, claims.workspaceId, claims.inboxId);
  if (inbox === null) {
    throw new ApiHttpError(401, "unauthorized", "The customer inbox is unavailable");
  }
  await requireAllowedOrigin(context, inbox);
  const visitor = await findVisitorById(db, {
    workspaceId: claims.workspaceId,
    inboxId: claims.inboxId,
    visitorId: claims.visitorId,
  });
  if (visitor === null) {
    throw new ApiHttpError(401, "unauthorized", "The customer profile is unavailable");
  }
  return { claims, inbox, visitor };
}

async function requireOwnedThread(
  context: ApiContext,
  auth: CustomerRequestAuth,
  threadId: string,
): Promise<ThreadRow> {
  const thread = await findThreadById(createDatabase(context.env.DB), {
    workspaceId: auth.claims.workspaceId,
    inboxId: auth.claims.inboxId,
    threadId,
  });
  if (thread === null || thread.visitorId !== auth.claims.visitorId) {
    throw new ApiHttpError(404, "not_found", "The support thread was not found");
  }
  return thread;
}

function messageAcceptance(message: MessageRow): MessageAcceptanceV1 {
  if (message.clientMessageId === null) {
    throw new ApiHttpError(500, "internal_error", "Customer message identity is missing");
  }
  if (message.processingStatus === "failed") {
    return {
      messageId: message.id,
      clientMessageId: message.clientMessageId,
      status: "failed",
      ...(message.failureCode === null ? {} : { failureCode: message.failureCode }),
      message: toCustomerMessageV1(message),
    };
  }
  if (message.processingStatus === "succeeded") {
    return {
      messageId: message.id,
      clientMessageId: message.clientMessageId,
      status: "available",
      message: toCustomerMessageV1(message),
    };
  }
  return {
    messageId: message.id,
    clientMessageId: message.clientMessageId,
    status: "processing",
    message: toCustomerMessageV1(message),
  };
}

function workflowOnlyAcceptance(input: {
  readonly messageId: string;
  readonly clientMessageId: string;
  readonly workflow: WorkflowAcceptance;
}): MessageAcceptanceV1 {
  if (input.workflow.kind === "unknown") {
    return {
      messageId: input.messageId,
      clientMessageId: input.clientMessageId,
      status: "acceptance_unknown",
    };
  }
  if (input.workflow.kind === "created") {
    return {
      messageId: input.messageId,
      clientMessageId: input.clientMessageId,
      status: "accepted",
    };
  }
  return {
    messageId: input.messageId,
    clientMessageId: input.clientMessageId,
    status: isActiveWorkflow(input.workflow.status.status) ? "already_accepted" : "failed",
    ...(isActiveWorkflow(input.workflow.status.status) ? {} : { failureCode: "ingress_failed" }),
  };
}

async function restartOrRecreateFailedCustomerWorkflow(input: {
  readonly context: ApiContext;
  readonly workflowInstanceId: string;
  readonly envelope: MessageWorkflowEnvelope;
}): Promise<WorkflowAcceptance> {
  const accepted = await acceptWorkflow(
    input.context.env.MESSAGE_WORKFLOW,
    input.workflowInstanceId,
    input.envelope,
  );
  if (accepted.kind === "existing" && accepted.status.status === "errored") {
    try {
      const instance = await input.context.env.MESSAGE_WORKFLOW.get(input.workflowInstanceId);
      await instance.restart();
      return { kind: "created" };
    } catch (cause) {
      return { kind: "unknown", cause };
    }
  }
  return accepted;
}

function visitorWorkflowContext(visitor: VisitorRow) {
  return {
    ...(visitor.locale === null ? {} : { locale: visitor.locale }),
    ...(visitor.timezone === null ? {} : { timezone: visitor.timezone }),
    ...(visitor.posthogDistinctId === null ? {} : { posthogDistinctId: visitor.posthogDistinctId }),
    ...(visitor.externalUserId === null ? {} : { externalUserId: visitor.externalUserId }),
    ...(visitor.email === null ? {} : { email: visitor.email }),
    ...(visitor.userAgent === null ? {} : { userAgent: visitor.userAgent }),
    ...(visitor.region === null ? {} : { region: visitor.region }),
  };
}

function workflowStatusText(
  status: WorkflowStatusSnapshot | null,
  message: MessageRow | null,
): string {
  if (message !== null) {
    switch (toMessageBusinessStatus(message)) {
      case "available":
        return "Already available in chat.";
      case "audit_failed":
        return "Available in chat, but the Discord audit failed.";
      case "not_available":
        return "The reply was not made available in chat.";
      case "failed":
        return "Processing failed before the reply became available.";
      case "processing":
        return "Processing is still in progress.";
    }
  }
  if (status === null) return "No acceptance was found for that reference.";
  if (status.status === "unknown") return "No acceptance was found for that reference.";
  if (isActiveWorkflow(status.status)) return "Processing is still in progress.";
  return status.status === "complete"
    ? "Processing completed, but its transcript state is unavailable."
    : "Ingress or processing failed before transcript persistence.";
}

function parseListQuery(context: ApiContext) {
  const after = context.req.query("after");
  const rawLimit = context.req.query("limit");
  const limit = rawLimit === undefined ? undefined : Number(rawLimit);
  return ListMessagesQueryV1Schema.parse({
    ...(after === undefined ? {} : { after }),
    ...(limit === undefined ? {} : { limit }),
  });
}

async function parseRequestJson(context: ApiContext): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new ApiHttpError(400, "invalid_request", "The request body must be valid JSON");
  }
}

function customerEnvelope(input: {
  readonly auth: CustomerRequestAuth;
  readonly thread: ThreadRow;
  readonly messageId: string;
  readonly workflowInstanceId: string;
  readonly clientMessageId: string;
  readonly originalText: string;
  readonly acceptedAt: Date;
}): MessageWorkflowEnvelope {
  return {
    schema: "respondkit.workflow-message/1",
    direction: "customer_to_operator",
    workspaceId: input.auth.claims.workspaceId,
    inboxId: input.auth.claims.inboxId,
    threadId: input.thread.id,
    visitorId: input.auth.claims.visitorId,
    messageId: input.messageId,
    workflowInstanceId: input.workflowInstanceId,
    acceptedAt: input.acceptedAt.toISOString(),
    clientMessageId: input.clientMessageId,
    originalText: input.originalText,
    ...(input.auth.visitor.locale === null ? {} : { localeHint: input.auth.visitor.locale }),
    context: visitorWorkflowContext(input.auth.visitor),
  };
}

async function discordCommandContext(
  context: ApiContext,
  interaction: ParsedDiscordCommandInteraction,
) {
  if (
    interaction.threadType !== DiscordChannelType.GuildPublicThread ||
    interaction.forumChannelId === undefined
  ) {
    return null;
  }
  const resolved = await resolveAuthorizedDiscordThread(createDatabase(context.env.DB), {
    applicationId: interaction.applicationId,
    guildId: interaction.guildId,
    forumChannelId: interaction.forumChannelId,
    discordThreadId: interaction.discordThreadId,
    operatorUserId: interaction.operatorUserId,
    operatorRoleIds: interaction.operatorRoleIds,
  });
  return resolved.ok ? resolved : null;
}

function operatorEnvelope(input: {
  readonly command: ReturnType<typeof normalizeDiscordCommand> & { readonly command: "reply" };
  readonly integrationId: string;
  readonly workspaceId: string;
  readonly inboxId: string;
  readonly thread: ThreadRow;
  readonly messageId: string;
  readonly workflowInstanceId: string;
  readonly acceptedAt: Date;
}): MessageWorkflowEnvelope {
  return {
    schema: "respondkit.workflow-message/1",
    direction: "operator_to_customer",
    workspaceId: input.workspaceId,
    inboxId: input.inboxId,
    threadId: input.thread.id,
    visitorId: input.thread.visitorId,
    messageId: input.messageId,
    workflowInstanceId: input.workflowInstanceId,
    acceptedAt: input.acceptedAt.toISOString(),
    originalText: input.command.message,
    discord: {
      integrationId: input.integrationId,
      interactionId: input.command.interactionId,
      applicationId: input.command.applicationId,
      guildId: input.command.guildId,
      threadId: input.command.discordThreadId,
      operatorId: input.command.operatorUserId,
      operatorRoleIds: [...input.command.operatorRoleIds],
    },
  };
}

export function createHttpApp() {
  const app = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

  app.use("*", async (context, next) => {
    try {
      await next();
    } finally {
      applyCorsHeaders(context);
    }
  });

  app.onError((error, context) => {
    if (error instanceof ApiHttpError) return apiError(context, error);
    if (error instanceof z.ZodError) {
      return apiError(
        context,
        new ApiHttpError(400, "invalid_request", "The request payload is invalid"),
      );
    }
    console.error("Unhandled RespondKit API error", error);
    return apiError(
      context,
      new ApiHttpError(500, "internal_error", "RespondKit could not process the request", true),
    );
  });

  app.options("/v1/*", (context) => {
    const origin = requestOrigin(context);
    context.set("corsOrigin", origin);
    return context.body(null, 204);
  });

  app.get("/health", (context) =>
    context.json({
      ok: true,
      service: "respondkit-api",
    }),
  );

  app.post("/v1/client/sessions", async (context) => {
    const request = CreateClientSessionRequestV1Schema.parse(await parseRequestJson(context));
    const db = createDatabase(context.env.DB);
    const inbox = await findInboxByPublicId(db, request.inboxId);
    if (inbox === null) {
      throw new ApiHttpError(404, "not_found", "The requested support inbox was not found");
    }
    await requireAllowedOrigin(context, inbox);

    const visitorId = await deriveVisitorId({
      workspaceId: inbox.workspaceId,
      inboxId: inbox.inboxId,
      installationId: request.installationId,
    });
    const rawRequest = context.req.raw as Request & {
      readonly cf?: { readonly country?: string; readonly region?: string };
    };
    const observedRegion = rawRequest.cf?.country ?? rawRequest.cf?.region;
    const visitor = await upsertVisitor(db, {
      id: visitorId,
      installationId: request.installationId,
      workspaceId: inbox.workspaceId,
      inboxId: inbox.inboxId,
      observedAt: new Date(),
      externalUserId: request.context?.userId,
      email: request.context?.email,
      posthogDistinctId: request.context?.posthogDistinctId,
      locale: request.context?.locale,
      timezone: request.context?.timezone,
      region: observedRegion,
      userAgent: context.req.header("user-agent")?.slice(0, 1_024),
      metadata: request.context?.metadata,
    });
    const session = await createAnonymousSession({
      signingKey: context.env.SESSION_SIGNING_KEY,
      sessionId: createClientSessionId(),
      workspaceId: inbox.workspaceId,
      inboxId: inbox.inboxId,
      visitorId: visitor.id,
      ...(context.env.SESSION_TTL_SECONDS === undefined
        ? {}
        : { lifetimeSeconds: Number(context.env.SESSION_TTL_SECONDS) }),
    });
    return context.json(
      {
        session: {
          id: session.claims.sessionId,
          token: session.token,
          visitorId: session.claims.visitorId,
          expiresAt: new Date(session.claims.expiresAt * 1_000).toISOString(),
        },
      },
      201,
    );
  });

  app.post("/v1/threads", async (context) => {
    const auth = await authenticateCustomer(context);
    const request = CreateThreadRequestV1Schema.parse(await parseRequestJson(context));
    const createdAt = new Date();
    const id = await deriveThreadId({
      workspaceId: auth.claims.workspaceId,
      inboxId: auth.claims.inboxId,
      visitorId: auth.claims.visitorId,
      clientThreadId: request.clientThreadId,
    });
    const thread = await createThread(createDatabase(context.env.DB), {
      id,
      workspaceId: auth.claims.workspaceId,
      inboxId: auth.claims.inboxId,
      visitorId: auth.claims.visitorId,
      clientThreadId: request.clientThreadId,
      createdAt,
      customerLanguage: auth.visitor.locale,
    });
    return context.json(
      {
        thread: {
          id: thread.id,
          clientThreadId: thread.clientThreadId,
          state: thread.status,
          createdAt: thread.createdAt.toISOString(),
          updatedAt: thread.updatedAt.toISOString(),
        },
      },
      201,
    );
  });

  app.get("/v1/threads/:threadId/messages", async (context) => {
    const auth = await authenticateCustomer(context);
    const thread = await requireOwnedThread(context, auth, context.req.param("threadId"));
    const query = parseListQuery(context);
    return context.json(
      await listCustomerMessages(createDatabase(context.env.DB), {
        workspaceId: auth.claims.workspaceId,
        inboxId: auth.claims.inboxId,
        threadId: thread.id,
        ...(query.after === undefined ? {} : { after: query.after }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      }),
    );
  });

  app.post("/v1/threads/:threadId/messages", async (context) => {
    const auth = await authenticateCustomer(context);
    const thread = await requireOwnedThread(context, auth, context.req.param("threadId"));
    if (thread.status !== "open") {
      throw new ApiHttpError(409, "conflict", "The support thread is closed");
    }
    const request = SendMessageRequestV1Schema.parse(await parseRequestJson(context));
    const db = createDatabase(context.env.DB);
    const existing = await findCustomerMessageByClientId(db, {
      workspaceId: auth.claims.workspaceId,
      inboxId: auth.claims.inboxId,
      threadId: thread.id,
      clientMessageId: request.clientMessageId,
    });
    if (existing !== null) {
      if (existing.originalText !== request.text) {
        throw new ApiHttpError(
          409,
          "conflict",
          "The client message ID already belongs to another immutable payload",
        );
      }
      if (existing.processingStatus !== "failed") {
        return context.json({ acceptance: messageAcceptance(existing) }, 200);
      }

      const identity = await deriveCustomerMessageIdentity({
        workspaceId: auth.claims.workspaceId,
        threadId: thread.id,
        clientMessageId: request.clientMessageId,
      });
      if (
        identity.messageId !== existing.id ||
        identity.workflowInstanceId !== existing.workflowInstanceId
      ) {
        throw new ApiHttpError(500, "internal_error", "Stored message identity is inconsistent");
      }
      const workflow = await restartOrRecreateFailedCustomerWorkflow({
        context,
        workflowInstanceId: identity.workflowInstanceId,
        envelope: customerEnvelope({
          auth,
          thread,
          ...identity,
          clientMessageId: request.clientMessageId,
          originalText: existing.originalText,
          acceptedAt: existing.acceptedAt,
        }),
      });
      const retried = await findCustomerMessageByClientId(db, {
        workspaceId: auth.claims.workspaceId,
        inboxId: auth.claims.inboxId,
        threadId: thread.id,
        clientMessageId: request.clientMessageId,
      });
      const acceptance =
        retried !== null && retried.processingStatus !== "failed"
          ? messageAcceptance(retried)
          : workflowOnlyAcceptance({
              ...identity,
              clientMessageId: request.clientMessageId,
              workflow,
            });
      return context.json({ acceptance }, acceptance.status === "acceptance_unknown" ? 200 : 202);
    }

    const identity = await deriveCustomerMessageIdentity({
      workspaceId: auth.claims.workspaceId,
      threadId: thread.id,
      clientMessageId: request.clientMessageId,
    });
    const acceptedAt = new Date();
    const envelope = customerEnvelope({
      auth,
      thread,
      ...identity,
      clientMessageId: request.clientMessageId,
      originalText: request.text,
      acceptedAt,
    });
    const workflow = await acceptWorkflow(
      context.env.MESSAGE_WORKFLOW,
      identity.workflowInstanceId,
      envelope,
    );
    const canonical = await findCustomerMessageByClientId(db, {
      workspaceId: auth.claims.workspaceId,
      inboxId: auth.claims.inboxId,
      threadId: thread.id,
      clientMessageId: request.clientMessageId,
    });
    const acceptance =
      canonical === null
        ? workflowOnlyAcceptance({
            ...identity,
            clientMessageId: request.clientMessageId,
            workflow,
          })
        : messageAcceptance(canonical);
    return context.json({ acceptance }, acceptance.status === "acceptance_unknown" ? 200 : 202);
  });

  app.post("/v1/discord/interactions", async (context) => {
    const requestStartedAt = Date.now();
    const signature = context.req.header("x-signature-ed25519");
    const timestamp = context.req.header("x-signature-timestamp");
    if (signature === undefined || timestamp === undefined) {
      return context.text("invalid request signature", 401);
    }
    const rawBody = await context.req.text();
    const verification = await verifyDiscordSignature({
      publicKeyHex: context.env.DISCORD_PUBLIC_KEY,
      signatureHex: signature,
      timestamp,
      rawBody,
    });
    if (!verification.ok) return context.text("invalid request signature", 401);

    let interaction;
    try {
      interaction = parseDiscordInteraction(rawBody);
    } catch (error) {
      if (error instanceof DiscordInteractionParseError) {
        return context.json(createEphemeralInteractionResponse(error.message), 400);
      }
      throw error;
    }
    if (interaction.applicationId !== context.env.DISCORD_APPLICATION_ID) {
      return context.text("invalid application", 401);
    }
    if (interaction.kind === "ping") return context.json(DISCORD_PONG_RESPONSE);

    const command = normalizeDiscordCommand(interaction);
    const commandPromise = (async () => {
      const authorized = await discordCommandContext(context, interaction);
      if (authorized === null) {
        return context.json(
          createEphemeralInteractionResponse(
            "This command is not authorized in the current support thread.",
          ),
        );
      }
      const db = createDatabase(context.env.DB);
      const thread = await findThreadById(db, {
        workspaceId: authorized.integration.workspaceId,
        inboxId: authorized.integration.inboxId,
        threadId: authorized.thread.threadId,
      });
      if (thread === null) {
        return context.json(createEphemeralInteractionResponse("The support thread is missing."));
      }
      const acceptedAt = discordInteractionAcceptedAt(command.interactionId);

      if (command.command === "reply") {
        const canonical = await findDiscordReplyByReference(db, {
          integrationId: authorized.integration.id,
          interactionId: command.interactionId,
          workspaceId: authorized.integration.workspaceId,
          inboxId: authorized.integration.inboxId,
        });
        if (canonical !== null) {
          if (canonical.interaction.threadId !== thread.id) {
            return context.json(
              createEphemeralInteractionResponse(
                "That interaction already belongs to another support thread.",
              ),
            );
          }
          if (canonical.message.originalText !== command.message) {
            return context.json(
              createEphemeralInteractionResponse(
                "That interaction ID already belongs to another immutable reply.",
              ),
            );
          }
          return context.json(
            createEphemeralInteractionResponse(workflowStatusText(null, canonical.message)),
          );
        }

        const identity = await deriveOperatorMessageIdentity(command);
        const envelope = operatorEnvelope({
          command,
          integrationId: authorized.integration.id,
          workspaceId: authorized.integration.workspaceId,
          inboxId: authorized.integration.inboxId,
          thread,
          ...identity,
          acceptedAt,
        });
        const accepted = await acceptWorkflow(
          context.env.MESSAGE_WORKFLOW,
          identity.workflowInstanceId,
          envelope,
        );
        if (accepted.kind === "unknown") {
          return context.json(
            createEphemeralInteractionResponse(
              `Acceptance could not be confirmed — do not resend. Use /status with reference ${command.interactionId}.`,
            ),
          );
        }
        if (accepted.kind === "existing" && !isActiveWorkflow(accepted.status.status)) {
          const canonical = await findDiscordReplyByReference(db, {
            integrationId: authorized.integration.id,
            interactionId: command.interactionId,
            workspaceId: authorized.integration.workspaceId,
            inboxId: authorized.integration.inboxId,
          });
          return context.json(
            createEphemeralInteractionResponse(
              workflowStatusText(accepted.status, canonical?.message ?? null),
            ),
          );
        }
        return context.json(
          createEphemeralInteractionResponse("Queued for translation and delivery."),
        );
      }

      const originalIdentity = await deriveOperatorMessageIdentity({
        applicationId: command.applicationId,
        interactionId: command.reference,
      });
      const original = await findDiscordReplyByReference(db, {
        integrationId: authorized.integration.id,
        interactionId: command.reference,
        workspaceId: authorized.integration.workspaceId,
        inboxId: authorized.integration.inboxId,
      });
      const status = await workflowStatus(
        context.env.MESSAGE_WORKFLOW,
        originalIdentity.workflowInstanceId,
      );
      if (original !== null && original.interaction.threadId !== thread.id) {
        return context.json(
          createEphemeralInteractionResponse("That reference belongs to another support thread."),
        );
      }

      const recoveryBase = {
        integrationId: authorized.integration.id,
        interactionId: command.interactionId,
        workspaceId: authorized.integration.workspaceId,
        inboxId: authorized.integration.inboxId,
        threadId: thread.id,
        applicationId: command.applicationId,
        guildId: command.guildId,
        discordThreadId: command.discordThreadId,
        operatorUserId: command.operatorUserId,
        operatorRoleIds: command.operatorRoleIds,
        referenceInteractionId: command.reference,
        acceptedAt,
      };
      await recordRecoveryInteraction(
        db,
        command.command === "status"
          ? { ...recoveryBase, commandName: "status" }
          : {
              ...recoveryBase,
              commandName: "retry",
              originalEnglishText: command.message,
            },
      );

      if (command.command === "status") {
        return context.json(
          createEphemeralInteractionResponse(workflowStatusText(status, original?.message ?? null)),
        );
      }
      if (original !== null && original.message.originalText !== command.message) {
        return context.json(
          createEphemeralInteractionResponse(
            "Retry text does not match the original immutable English reply.",
          ),
        );
      }
      if (original !== null && original.message.customerAvailability === "available") {
        return context.json(
          createEphemeralInteractionResponse(workflowStatusText(status, original.message)),
        );
      }
      if (status !== null && isActiveWorkflow(status.status)) {
        return context.json(createEphemeralInteractionResponse("Processing is still in progress."));
      }
      if (status?.status === "errored") {
        const instance = await context.env.MESSAGE_WORKFLOW.get(
          originalIdentity.workflowInstanceId,
        );
        await instance.restart();
        return context.json(
          createEphemeralInteractionResponse("Retry queued with the original ID."),
        );
      }

      if (status !== null && status.status !== "unknown") {
        return context.json(
          createEphemeralInteractionResponse(workflowStatusText(status, original?.message ?? null)),
        );
      }

      const retryCommand =
        original === null
          ? {
              ...command,
              command: "reply" as const,
              interactionId: command.reference,
              message: command.message,
            }
          : {
              command: "reply" as const,
              interactionId: original.interaction.interactionId,
              applicationId: original.interaction.applicationId,
              guildId: original.interaction.guildId,
              discordThreadId: original.interaction.discordThreadId,
              operatorUserId: original.interaction.operatorUserId,
              operatorRoleIds: original.interaction.operatorRoleIds,
              message: original.message.originalText,
            };
      const retryEnvelope = operatorEnvelope({
        command: retryCommand,
        integrationId: authorized.integration.id,
        workspaceId: authorized.integration.workspaceId,
        inboxId: authorized.integration.inboxId,
        thread,
        ...originalIdentity,
        acceptedAt: original?.message.acceptedAt ?? discordInteractionAcceptedAt(command.reference),
      });
      const retried = await acceptWorkflow(
        context.env.MESSAGE_WORKFLOW,
        originalIdentity.workflowInstanceId,
        retryEnvelope,
      );
      if (retried.kind === "existing" && !isActiveWorkflow(retried.status.status)) {
        const canonical = await findDiscordReplyByReference(db, {
          integrationId: authorized.integration.id,
          interactionId: command.reference,
          workspaceId: authorized.integration.workspaceId,
          inboxId: authorized.integration.inboxId,
        });
        return context.json(
          createEphemeralInteractionResponse(
            workflowStatusText(retried.status, canonical?.message ?? null),
          ),
        );
      }
      return context.json(
        createEphemeralInteractionResponse(
          retried.kind === "unknown"
            ? `Retry acceptance is pending. Use /status with reference ${command.reference}.`
            : "Retry queued with the original ID.",
        ),
      );
    })();
    const processed = await beforeDiscordResponseCutoff(commandPromise, requestStartedAt);
    if (processed === "cutoff") {
      context.executionCtx.waitUntil(
        commandPromise.then(
          () => undefined,
          () => undefined,
        ),
      );
      return context.json(
        createEphemeralInteractionResponse(
          command.command === "reply"
            ? `Acceptance pending — do not resend yet. Reference: ${command.interactionId}`
            : command.command === "status"
              ? `Status lookup is still pending for reference ${command.reference}.`
              : `Retry acceptance is pending. Use /status with reference ${command.reference}.`,
        ),
      );
    }
    return processed;
  });

  return app;
}
