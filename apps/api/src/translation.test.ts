import { acceptCustomerIngress, markCustomerMessageProjected } from "@respondkit/conversations";
import { beginDiscordProjection, markDiscordProjectionSent } from "@respondkit/discord";
import {
  InboxIdSchema,
  WorkspaceIdSchema,
  deriveCustomerMessageIdentity,
  type ClientMessageId,
} from "@respondkit/protocol";
import type { TranslationResult } from "@respondkit/translation";
import { env, introspectWorkflow } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createDatabase } from "./db";
import {
  createTranslationTool,
  getTranslationJob,
  requestMessageTranslation,
  startTranslationWorkflow,
} from "./translation-service";
import {
  handleTranslationInteraction,
  freezeTranslationSelection,
  replyReview,
  resolveTranslationMessage,
} from "./discord-translation";
import {
  TEST_TOPOLOGY,
  createCustomerFixture,
  createTestEnv,
  seedReadyDiscordThread,
  seedTopology,
  snowflakeAt,
} from "../test/fixtures";
import { deriveOperatorMessageIdentity } from "./identity";

const result = {
  ambiguityNotes: [],
  mixedLanguage: false,
  modelId: "test-model",
  needsReview: false,
  passThrough: false,
  promptVersion: "respondkit-translation-v1",
  provider: "test",
  sourceLanguage: "hi",
  targetLanguage: "en",
  translatedText: "The video does not play.",
} satisfies TranslationResult;

beforeEach(async () => seedTopology());

async function fixture() {
  const customer = await createCustomerFixture({ locale: "en" });
  await seedReadyDiscordThread(customer.threadId);
  const scope = {
    workspaceId: WorkspaceIdSchema.parse(TEST_TOPOLOGY.workspaceId),
    inboxId: InboxIdSchema.parse(TEST_TOPOLOGY.inboxId),
    threadId: customer.threadId,
  };
  const clientMessageId = `client_${crypto.randomUUID()}` as ClientMessageId;
  const identity = await deriveCustomerMessageIdentity({ ...scope, clientMessageId });
  const db = createDatabase(env.DB);
  await acceptCustomerIngress(db, {
    ...scope,
    id: identity.messageId,
    clientMessageId,
    workflowInstanceId: identity.workflowInstanceId,
    originalText: "वीडियो नहीं चल रहा है",
    acceptedAt: new Date(),
  });
  await markCustomerMessageProjected(db, {
    ...scope,
    messageId: identity.messageId,
    generation: 1,
    transitionedAt: new Date(),
  });
  const projection = {
    ...scope,
    messageId: identity.messageId,
    projectionKind: "customer_projection" as const,
    chunkIndex: 0,
  };
  await beginDiscordProjection(db, {
    ...projection,
    integrationId: TEST_TOPOLOGY.integrationId,
    nonce: "fixture",
    correlationMarker: "fixture",
    discordThreadId: TEST_TOPOLOGY.discordThreadId,
    createdAt: new Date(),
  });
  await markDiscordProjectionSent(db, {
    ...projection,
    discordMessageId: "100000000000000081",
    sentAt: new Date(),
  });
  return { customer, scope, identity };
}

function interaction() {
  return {
    kind: "command" as const,
    command: "translate" as const,
    interactionId: snowflakeAt(),
    applicationId: TEST_TOPOLOGY.applicationId,
    token: "ephemeral-test",
    guildId: TEST_TOPOLOGY.guildId,
    discordThreadId: TEST_TOPOLOGY.discordThreadId,
    forumChannelId: TEST_TOPOLOGY.forumChannelId,
    threadType: 11,
    operatorUserId: TEST_TOPOLOGY.operatorId,
    operatorRoleIds: [TEST_TOPOLOGY.operatorRoleId],
    targetLanguage: "en",
  };
}

describe("optional message translation", () => {
  it("shares a cached translation with an agent and posts one Discord reply without changing delivery", async () => {
    const { scope, identity } = await fixture();
    const workflows = await introspectWorkflow(env.TRANSLATION_WORKFLOW);
    const posted: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_request, init) => {
        if (init?.method === "GET") return Response.json([]);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        posted.push(body);
        return Response.json({
          id: "100000000000000082",
          channel_id: TEST_TOPOLOGY.discordThreadId,
          content: body.content,
          nonce: body.nonce,
        });
      }),
    );
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult({ name: "translate-message" }, result);
      });
      const apiEnv = createTestEnv();
      const tool = createTranslationTool(apiEnv, scope);
      const pending = await tool.execute({ message_id: identity.messageId, target_language: "en" });
      const [translation] = await workflows.get();
      if (!translation) throw new Error("Expected translation workflow");
      await translation.waitForStatus("complete");
      expect(posted).toHaveLength(0); // The agent tool does not publish.
      const cached = await tool.execute({ message_id: identity.messageId, target_language: "en" });
      expect(cached).toMatchObject({
        translation_id: pending.translation_id,
        status: "succeeded",
        translatedText: result.translatedText,
      });
      expect(await workflows.get()).toHaveLength(1);
      const job = await getTranslationJob(apiEnv, scope, pending.translation_id);
      if (!job) throw new Error("Expected job");
      await startTranslationWorkflow(apiEnv, job, "publish");
      const instances = await workflows.get();
      const publication = instances[1];
      if (!publication) throw new Error("Expected publication workflow");
      await publication.waitForStatus("complete");
      await startTranslationWorkflow(apiEnv, job, "publish");
      expect(posted).toHaveLength(1);
      expect(posted[0]).toMatchObject({
        message_reference: { message_id: "100000000000000081", fail_if_not_exists: false },
        allowed_mentions: { parse: [], replied_user: false },
      });
      expect(
        await env.DB.prepare("SELECT processing_status, original_text FROM message WHERE id = ?")
          .bind(identity.messageId)
          .first(),
      ).toEqual({ processing_status: "succeeded", original_text: "वीडियो नहीं चल रहा है" });
      expect(
        await env.DB.prepare("SELECT customer_language FROM thread WHERE id = ?")
          .bind(scope.threadId)
          .first(),
      ).toEqual({ customer_language: "hi" });
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("keeps message delivery successful when the translation job fails", async () => {
    const { scope, identity } = await fixture();
    const workflows = await introspectWorkflow(env.TRANSLATION_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepError({ name: "translate-message" }, new Error("Provider down"));
      });
      const apiEnv = createTestEnv();
      const job = await requestMessageTranslation(apiEnv, scope, identity.messageId, "en");
      const [instance] = await workflows.get();
      if (!instance) throw new Error("Expected workflow");
      await instance.waitForStatus("errored");
      const failed = await getTranslationJob(apiEnv, scope, job.id);
      expect(failed?.status).toBe("failed");
      expect(
        await env.DB.prepare("SELECT processing_status, failure_stage FROM message WHERE id = ?")
          .bind(identity.messageId)
          .first(),
      ).toEqual({ processing_status: "succeeded", failure_stage: null });
      const retry = await requestMessageTranslation(apiEnv, scope, identity.messageId, "en");
      expect(retry.generation).toBe(2);
      expect(retry.id).toBe(job.id);
      const instances = await workflows.get();
      await instances[1]?.waitForStatus("errored");
    } finally {
      await workflows.dispose();
    }
  });

  it("rejects other-thread targets and disabled inboxes, and resolves exact Discord messages", async () => {
    const { scope, identity } = await fixture();
    const apiEnv = createTestEnv();
    await expect(
      requestMessageTranslation(
        apiEnv,
        { ...scope, threadId: "another-thread" },
        identity.messageId,
        "en",
      ),
    ).rejects.toThrow("Select a customer message");
    await expect(
      requestMessageTranslation(
        createTestEnv({ TRANSLATION_ENABLED_INBOXES: "[]" }),
        scope,
        identity.messageId,
        "en",
      ),
    ).rejects.toThrow("not enabled");
    expect(
      await resolveTranslationMessage(apiEnv, scope, {
        ...interaction(),
        targetMessageId: "100000000000000081",
      }),
    ).toBe(identity.messageId);
    await expect(
      resolveTranslationMessage(apiEnv, scope, {
        ...interaction(),
        messageLink: "https://discord.com/channels/1/2/3",
      }),
    ).rejects.toThrow("this support thread");
    await expect(
      resolveTranslationMessage(apiEnv, scope, {
        ...interaction(),
        targetMessageId: "999999999999999999",
      }),
    ).rejects.toThrow("original customer message");
  });

  it("records a provider rejection without leaking its response body or failing delivery", async () => {
    const { scope, identity } = await fixture();
    const workflows = await introspectWorkflow(env.TRANSLATION_WORKFLOW);
    const fetch = vi.fn(async () =>
      Response.json(
        { error: { code: 400, message: "provider-private-detail", status: "INVALID_ARGUMENT" } },
        { status: 400 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      await workflows.modifyAll(async (modifier) => modifier.disableRetryDelays());
      const apiEnv = createTestEnv();
      const job = await requestMessageTranslation(apiEnv, scope, identity.messageId, "en");
      const [instance] = await workflows.get();
      await instance?.waitForStatus("errored");
      const stored = await getTranslationJob(apiEnv, scope, job.id);
      expect(stored).toMatchObject({
        status: "failed",
        error_code: "provider_permanent",
        provider_status: 400,
      });
      expect(JSON.stringify(stored)).not.toContain("provider-private-detail");
      expect(fetch).toHaveBeenCalledOnce();
      const tool = createTranslationTool(apiEnv, scope);
      expect(
        await tool.execute({ message_id: identity.messageId, target_language: "en" }),
      ).toMatchObject({ status: "failed", error_code: "provider_permanent" });
      expect(await workflows.get()).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("freezes the latest-message selection across Discord redeliveries", async () => {
    const { scope, identity } = await fixture();
    const command = interaction();
    const apiEnv = createTestEnv();
    expect(await freezeTranslationSelection(apiEnv, scope, command)).toBe(identity.messageId);
    const clientMessageId = `client_${crypto.randomUUID()}` as ClientMessageId;
    const newer = await deriveCustomerMessageIdentity({ ...scope, clientMessageId });
    await acceptCustomerIngress(createDatabase(env.DB), {
      ...scope,
      id: newer.messageId,
      clientMessageId,
      workflowInstanceId: newer.workflowInstanceId,
      originalText: "Newer message",
      acceptedAt: new Date(Date.now() + 1000),
    });
    expect(await resolveTranslationMessage(apiEnv, scope, command)).toBe(newer.messageId);
    expect(await freezeTranslationSelection(apiEnv, scope, command)).toBe(identity.messageId);
  });

  it("does not post a duplicate for a message already in the target language", async () => {
    const { scope, identity } = await fixture();
    const workflows = await introspectWorkflow(env.TRANSLATION_WORKFLOW);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      await workflows.modifyAll(async (modifier) =>
        modifier.mockStepResult({ name: "translate-message" }, { ...result, sourceLanguage: "en" }),
      );
      const apiEnv = createTestEnv();
      const job = await requestMessageTranslation(apiEnv, scope, identity.messageId, "en");
      const [instance] = await workflows.get();
      await instance?.waitForStatus("complete");
      await startTranslationWorkflow(apiEnv, job, "publish");
      const instances = await workflows.get();
      await instances[1]?.waitForStatus("complete");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("holds an ambiguous outgoing translation until an authorized confirmation", async () => {
    const { scope } = await fixture();
    const reference = snowflakeAt();
    const identity = await deriveOperatorMessageIdentity({
      applicationId: TEST_TOPOLOGY.applicationId,
      interactionId: reference,
    });
    const thread = await env.DB.prepare("SELECT visitor_id FROM thread WHERE id = ?")
      .bind(scope.threadId)
      .first<{ visitor_id: string }>();
    if (!thread) throw new Error("Expected thread");
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({})),
    );
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult(
          { name: "translate-message" },
          { ...result, targetLanguage: "hi", sourceLanguage: "en", needsReview: true },
        );
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000084" },
        );
      });
      await env.MESSAGE_WORKFLOW.create({
        id: identity.workflowInstanceId,
        params: {
          schema: "respondkit.workflow-message/1",
          direction: "operator_to_customer",
          ...scope,
          ...identity,
          visitorId: thread.visitor_id,
          originalText: "Try again",
          acceptedAt: new Date().toISOString(),
          replyTranslation: "hi",
          replyTranslationRequest: "hi",
          discord: {
            integrationId: TEST_TOPOLOGY.integrationId,
            interactionId: reference,
            applicationId: TEST_TOPOLOGY.applicationId,
            guildId: TEST_TOPOLOGY.guildId,
            threadId: TEST_TOPOLOGY.discordThreadId,
            operatorId: TEST_TOPOLOGY.operatorId,
            operatorRoleIds: [TEST_TOPOLOGY.operatorRoleId],
          },
        },
      });
      const [instance] = await workflows.get();
      if (!instance) throw new Error("Expected workflow");
      await instance.waitForStepResult({ name: "save-reply-review" });
      const apiEnv = createTestEnv();
      const preview = await replyReview(apiEnv, identity.messageId, reference);
      expect(preview?.content).toContain("reply not sent");
      const confirm = {
        ...interaction(),
        command: "confirm_translation" as const,
        reference,
        generation: 1,
      };
      await handleTranslationInteraction(apiEnv, {
        ...confirm,
        operatorUserId: "999999999999999999",
        operatorRoleIds: [],
      });
      expect(
        await env.DB.prepare("SELECT customer_availability FROM message WHERE id = ?")
          .bind(identity.messageId)
          .first(),
      ).toEqual({ customer_availability: "pending" });
      await handleTranslationInteraction(apiEnv, confirm);
      await instance.waitForStatus("complete");
      expect(
        await env.DB.prepare("SELECT customer_availability FROM message WHERE id = ?")
          .bind(identity.messageId)
          .first(),
      ).toEqual({ customer_availability: "available" });
      expect(await replyReview(apiEnv, identity.messageId, reference)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });
});
