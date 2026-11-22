import { ListThreadStatusesResponseV1Schema } from "@respondkit/protocol";
import {
  acceptCustomerIngress,
  markCustomerMessageProjected,
  publishOperatorReply,
  recordTerminalFailure,
  storeCustomerTranslation,
} from "@respondkit/conversations";
import { acceptReplyIngress } from "@respondkit/discord";
import {
  CreateClientSessionResponseV1Schema,
  CreateThreadResponseV1Schema,
  InboxIdSchema,
  ListMessagesResponseV1Schema,
  SendMessageResponseV1Schema,
  WorkspaceIdSchema,
  deriveCustomerMessageIdentity,
  type ClientMessageId,
  type SessionToken,
  type ThreadId,
} from "@respondkit/protocol";
import type { TranslationResult } from "@respondkit/translation";
import {
  createExecutionContext,
  env,
  introspectWorkflow,
  waitOnExecutionContext,
  type WorkflowIntrospector,
} from "cloudflare:test";
import { NonRetryableError } from "cloudflare:workflows";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createDatabase } from "./db";
import type { Env as ApiEnv } from "./env";
import { createHttpApp } from "./http";
import { deriveOperatorMessageIdentity, translationRecordId } from "./identity";
import {
  DISCORD_INTERACTION_TOKEN_LIFETIME_MS,
  DISCORD_PREVIEW_DEADLINE_MS,
  PRIVATE_PREVIEW_RETRY_DELAY_MS,
  PRIVATE_PREVIEW_STEP,
  assertPreviewTokenActive,
} from "./workflows/message";
import {
  TEST_ORIGIN,
  TEST_TOPOLOGY,
  createCustomerFixture,
  createTestEnv,
  seedReadyDiscordThread,
  seedTopology,
  snowflakeAt,
} from "../test/fixtures";

const incomingTranslation = {
  ambiguityNotes: [],
  mixedLanguage: false,
  modelId: "gemini-3.1-flash-lite-preview",
  needsReview: false,
  passThrough: false,
  promptVersion: "respondkit-translation-v1",
  provider: "google.generative-ai",
  sourceLanguage: "my-MM",
  targetLanguage: "en",
  translatedText: "I cannot export my transcription.",
} satisfies TranslationResult;

const outgoingTranslation = {
  ambiguityNotes: [],
  mixedLanguage: false,
  modelId: "gemini-3.1-flash-lite-preview",
  needsReview: false,
  passThrough: false,
  promptVersion: "respondkit-translation-v1",
  provider: "google.generative-ai",
  sourceLanguage: "en",
  targetLanguage: "my-MM",
  translatedText: "ကျေးဇူးပြု၍ အက်ပ်ကို ပြန်ဖွင့်ပါ။",
} satisfies TranslationResult;

function authorizationHeaders(sessionToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${sessionToken}`,
    "content-type": "application/json",
    origin: TEST_ORIGIN,
  };
}

async function sendCustomerMessage(input: {
  readonly sessionToken: string;
  readonly threadId: ThreadId;
  readonly clientMessageId: ClientMessageId;
  readonly text: string;
}) {
  return createHttpApp().request(
    `/v1/threads/${input.threadId}/messages`,
    {
      method: "POST",
      headers: authorizationHeaders(input.sessionToken),
      body: JSON.stringify({ clientMessageId: input.clientMessageId, text: input.text }),
    },
    createTestEnv(),
  );
}

async function pollMessages(input: {
  readonly sessionToken: string;
  readonly threadId: ThreadId;
  readonly after?: string;
}) {
  const response = await createHttpApp().request(
    `/v1/threads/${input.threadId}/messages${
      input.after === undefined ? "" : `?after=${encodeURIComponent(input.after)}`
    }`,
    { headers: authorizationHeaders(input.sessionToken) },
    createTestEnv(),
  );
  expect(response.status).toBe(200);
  return ListMessagesResponseV1Schema.parse(await response.json());
}

async function createSession(input: {
  readonly installationId: string;
  readonly userId: string;
}): Promise<SessionToken> {
  const response = await createHttpApp().request(
    "/v1/client/sessions",
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: JSON.stringify({
        inboxId: TEST_TOPOLOGY.inboxId,
        installationId: input.installationId,
        context: { userId: input.userId, locale: "my-MM" },
      }),
    },
    createTestEnv(),
  );
  expect(response.status).toBe(201);
  return CreateClientSessionResponseV1Schema.parse(await response.json()).session.token;
}

async function oneCapturedWorkflow(introspector: WorkflowIntrospector) {
  const instances = await introspector.get();
  expect(instances).toHaveLength(1);
  const instance = instances[0];
  if (instance === undefined) throw new Error("Expected one captured Workflow instance");
  return instance;
}

beforeEach(async () => {
  await seedTopology();
});

describe("customer HTTP ingress and MessageWorkflow", () => {
  it("completes a customer post when Discord trims its trailing whitespace", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const text = "Kan je ook link doorsturen om te samen vatten en vertalen ";
    const discordMessageId = "1554171622695501925";
    const postedContent: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (_request, init) => {
        if (init?.method === "GET") return Response.json([]);
        if (init?.method !== "POST" || typeof init.body !== "string")
          throw new Error("Unexpected Discord request");
        const body = JSON.parse(init.body) as { content: string; nonce: string };
        postedContent.push(body.content);
        return Response.json({
          id: discordMessageId,
          channel_id: TEST_TOPOLOGY.discordThreadId,
          content: body.content.trim(),
          nonce: body.nonce,
        });
      }),
    );
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => modifier.disableRetryDelays());
      const response = await sendCustomerMessage({
        ...customer,
        clientMessageId: `client_${crypto.randomUUID()}` as ClientMessageId,
        text,
      });
      expect(response.status).toBe(202);
      const { acceptance } = SendMessageResponseV1Schema.parse(await response.json());
      await (await oneCapturedWorkflow(workflows)).waitForStatus("complete");
      expect(postedContent).toEqual([`**Customer**\n${text}`]);
      expect(
        await env.DB.prepare("SELECT original_text, processing_status FROM message WHERE id = ?")
          .bind(acceptance.messageId)
          .first(),
      ).toEqual({
        original_text: text,
        processing_status: "succeeded",
      });
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("persists and projects the original customer message without invoking translation", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult({ name: "translate-message" }, incomingTranslation);
        await modifier.mockStepResult(
          { name: "project-customer-message-0" },
          { discordMessageId: "100000000000000099" },
        );
      });

      const clientMessageId = `client_message_${crypto.randomUUID()}` as ClientMessageId;
      const response = await sendCustomerMessage({
        ...customer,
        clientMessageId,
        text: "စာတမ်းကို export မလုပ်နိုင်ပါ။",
      });
      expect(response.status).toBe(202);
      const acceptance = SendMessageResponseV1Schema.parse(await response.json()).acceptance;
      expect(acceptance.clientMessageId).toBe(clientMessageId);
      expect(["accepted", "processing"]).toContain(acceptance.status);

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("complete");
      await expect(instance.getOutput()).resolves.toEqual({
        messageId: acceptance.messageId,
        status: "succeeded",
      });

      const transcript = await pollMessages(customer);
      expect(transcript.messages.at(-1)).toEqual(
        expect.objectContaining({
          id: acceptance.messageId,
          clientMessageId,
          direction: "customer_to_operator",
          text: "စာတမ်းကို export မလုပ်နိုင်ပါ။",
          language: "my-MM",
          state: "available",
        }),
      );

      const row = await env.DB.prepare(
        "select processing_status, operator_visible_text, operator_projection_status from message where id = ?",
      )
        .bind(acceptance.messageId)
        .first<{
          processing_status: string;
          operator_visible_text: string;
          operator_projection_status: string;
        }>();
      expect(row).toEqual({
        processing_status: "succeeded",
        operator_visible_text: "စာတမ်းကို export မလုပ်နိုင်ပါ။",
        operator_projection_status: "projected",
      });

      const duplicate = await sendCustomerMessage({
        ...customer,
        clientMessageId,
        text: "စာတမ်းကို export မလုပ်နိုင်ပါ။",
      });
      expect(duplicate.status).toBe(200);
      expect(SendMessageResponseV1Schema.parse(await duplicate.json()).acceptance).toMatchObject({
        messageId: acceptance.messageId,
        clientMessageId,
        status: "available",
      });

      const conflicting = await sendCustomerMessage({
        ...customer,
        clientMessageId,
        text: "This edit must not replace the first payload.",
      });
      expect(conflicting.status).toBe(409);
      await expect(conflicting.json()).resolves.toMatchObject({
        error: { code: "conflict", retryable: false },
      });
    } finally {
      await workflows.dispose();
    }
  });

  it("records a Discord delivery failure and keeps the original pollable", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepError(
          { name: "project-customer-message-0" },
          new Error("Discord is temporarily unavailable"),
        );
        await modifier.mockStepResult(
          { name: "post-failure-audit-0" },
          { discordMessageId: "100000000000000098" },
        );
      });

      const response = await sendCustomerMessage({
        ...customer,
        clientMessageId: `client_message_${crypto.randomUUID()}` as ClientMessageId,
        text: "ဘာဖြစ်နေတာလဲ",
      });
      expect(response.status).toBe(202);
      const acceptance = SendMessageResponseV1Schema.parse(await response.json()).acceptance;

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("errored");
      await expect(instance.getError()).resolves.toMatchObject({
        name: "Error",
        message: "Discord is temporarily unavailable",
      });

      const row = await env.DB.prepare(
        "select processing_status, failure_stage, failure_code, operator_projection_status from message where id = ?",
      )
        .bind(acceptance.messageId)
        .first<{
          processing_status: string;
          failure_stage: string;
          failure_code: string;
          operator_projection_status: string;
        }>();
      expect(row).toEqual({
        processing_status: "failed",
        failure_stage: "discord_projection",
        failure_code: "Error",
        operator_projection_status: "failed",
      });
      expect((await pollMessages(customer)).messages.at(-1)).toEqual(
        expect.objectContaining({ id: acceptance.messageId, state: "failed" }),
      );
    } finally {
      await workflows.dispose();
    }
  });

  it("requires the inbox's configured Origin before issuing a session", async () => {
    const response = await createHttpApp().request(
      "/v1/client/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://attacker.example" },
        body: JSON.stringify({
          inboxId: TEST_TOPOLOGY.inboxId,
          installationId: "installation_untrusted",
        }),
      },
      createTestEnv(),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("accepts any localhost port when a loopback wildcard is configured", async () => {
    await env.DB.prepare("update allowed_origin set origin = ? where id = ?")
      .bind("http://localhost:*", "allowed_origin_test")
      .run();

    const response = await createHttpApp().request(
      "/v1/client/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:5174" },
        body: JSON.stringify({
          inboxId: TEST_TOPOLOGY.inboxId,
          installationId: "installation_localhost_wildcard",
        }),
      },
      createTestEnv(),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5174");
  });

  it("reports malformed JSON as a non-retryable client error", async () => {
    const response = await createHttpApp().request(
      "/v1/client/sessions",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: TEST_ORIGIN },
        body: "{",
      },
      createTestEnv(),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request", retryable: false },
    });
  });

  it("returns a stable protocol result with HTTP 200 when Workflow acceptance is unknown", async () => {
    const customer = await createCustomerFixture();
    const createBatch = vi.fn(async () => {
      throw new Error("Workflow binding unavailable");
    });
    const unavailableWorkflow = { createBatch } as unknown as ApiEnv["MESSAGE_WORKFLOW"];
    const clientMessageId = `client_unknown_${crypto.randomUUID()}` as ClientMessageId;
    const response = await createHttpApp().request(
      `/v1/threads/${customer.threadId}/messages`,
      {
        method: "POST",
        headers: authorizationHeaders(customer.sessionToken),
        body: JSON.stringify({ clientMessageId, text: "Can you help?" }),
      },
      createTestEnv({ MESSAGE_WORKFLOW: unavailableWorkflow }),
    );

    expect(response.status).toBe(200);
    expect(SendMessageResponseV1Schema.parse(await response.json()).acceptance).toMatchObject({
      clientMessageId,
      status: "acceptance_unknown",
    });
    expect(createBatch).toHaveBeenCalledTimes(2);
  });

  it("does not let another installation claim a transcript with an advisory user ID", async () => {
    const unique = crypto.randomUUID().replaceAll("-", "");
    const sharedUserId = `shared_user_${unique}`;
    const firstToken = await createSession({
      installationId: `installation_first_${unique}`,
      userId: sharedUserId,
    });
    const threadResponse = await createHttpApp().request(
      "/v1/threads",
      {
        method: "POST",
        headers: authorizationHeaders(firstToken),
        body: JSON.stringify({ clientThreadId: `private_thread_${unique}` }),
      },
      createTestEnv(),
    );
    expect(threadResponse.status).toBe(201);
    const privateThread = CreateThreadResponseV1Schema.parse(await threadResponse.json()).thread;

    const secondToken = await createSession({
      installationId: `installation_second_${unique}`,
      userId: sharedUserId,
    });
    const unauthorized = await createHttpApp().request(
      `/v1/threads/${privateThread.id}/messages`,
      { headers: authorizationHeaders(secondToken) },
      createTestEnv(),
    );
    expect(unauthorized.status).toBe(404);

    const visitors = await env.DB.prepare(
      "select count(*) as count from visitor where workspace_id = ? and inbox_id = ?",
    )
      .bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId)
      .first<{ count: number }>();
    expect(visitors?.count).toBe(2);
  });

  it("does not skip an older pending operator reply when a later customer row advances the cursor", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const db = createDatabase(env.DB);
    const workspaceId = WorkspaceIdSchema.parse(TEST_TOPOLOGY.workspaceId);
    const inboxId = InboxIdSchema.parse(TEST_TOPOLOGY.inboxId);
    const now = Date.now();
    const operatorInteractionId = snowflakeAt(now - 2_000, 21n);
    const operatorIdentity = await deriveOperatorMessageIdentity({
      applicationId: TEST_TOPOLOGY.applicationId,
      interactionId: operatorInteractionId,
    });
    await acceptReplyIngress(db, {
      integrationId: TEST_TOPOLOGY.integrationId,
      interactionId: operatorInteractionId,
      workspaceId,
      inboxId,
      threadId: customer.threadId,
      ...operatorIdentity,
      applicationId: TEST_TOPOLOGY.applicationId,
      guildId: TEST_TOPOLOGY.guildId,
      discordThreadId: TEST_TOPOLOGY.discordThreadId,
      operatorUserId: TEST_TOPOLOGY.operatorId,
      operatorRoleIds: [TEST_TOPOLOGY.operatorRoleId],
      acceptedAt: new Date(now - 2_000),
      originalEnglishText: "Please reopen the app.",
    });

    const clientMessageId = `client_cursor_${crypto.randomUUID()}` as ClientMessageId;
    const customerIdentity = await deriveCustomerMessageIdentity({
      workspaceId,
      threadId: customer.threadId,
      clientMessageId,
    });
    await acceptCustomerIngress(db, {
      id: customerIdentity.messageId,
      workspaceId,
      inboxId,
      threadId: customer.threadId,
      clientMessageId,
      workflowInstanceId: customerIdentity.workflowInstanceId,
      acceptedAt: new Date(now),
      originalText: "အခုထိ မရသေးဘူး။",
      localeHint: "my-MM",
    });

    async function replyStatus() {
      const response = await createHttpApp().request(
        "/v1/thread-statuses",
        {
          headers: authorizationHeaders(customer.sessionToken),
        },
        createTestEnv(),
      );
      expect(response.status).toBe(200);
      return ListThreadStatusesResponseV1Schema.parse(await response.json()).threads.find(
        (item) => item.thread.id === customer.threadId,
      );
    }
    expect((await replyStatus())?.latestReplyCursor).toBe("0");
    const firstPage = await pollMessages(customer);
    expect(firstPage.messages).toEqual([
      expect.objectContaining({
        id: customerIdentity.messageId,
        direction: "customer_to_operator",
      }),
    ]);

    await publishOperatorReply(db, {
      id: `translation_${operatorIdentity.messageId}`,
      workspaceId,
      inboxId,
      threadId: customer.threadId,
      messageId: operatorIdentity.messageId,
      generation: 1,
      sourceLanguage: "en",
      targetLanguage: "my-MM",
      translatedText: outgoingTranslation.translatedText,
      promptVersion: "respondkit-translation-v1",
      provider: "test",
      model: "fixture",
      isPassThrough: false,
      mixedLanguage: false,
      needsReview: false,
      translatedAt: new Date(now + 1_000),
    });

    const secondPage = await pollMessages({ ...customer, after: firstPage.nextCursor });
    const replyCursor = (await replyStatus())?.latestReplyCursor;
    expect(replyCursor).toBe(secondPage.nextCursor);
    expect(Number(replyCursor)).toBeGreaterThan(Number(firstPage.nextCursor));
    expect(secondPage.messages).toEqual([
      expect.objectContaining({
        id: operatorIdentity.messageId,
        direction: "operator_to_customer",
        text: outgoingTranslation.translatedText,
      }),
    ]);
  });

  it("emits later state revisions after a widget advances past the processing cursor", async () => {
    const customer = await createCustomerFixture();
    const db = createDatabase(env.DB);
    const workspaceId = WorkspaceIdSchema.parse(TEST_TOPOLOGY.workspaceId);
    const inboxId = InboxIdSchema.parse(TEST_TOPOLOGY.inboxId);
    const acceptedAt = new Date("2026-08-25T11:00:00.000Z");

    const availableClientId = `client_available_${crypto.randomUUID()}` as ClientMessageId;
    const availableIdentity = await deriveCustomerMessageIdentity({
      workspaceId,
      threadId: customer.threadId,
      clientMessageId: availableClientId,
    });
    await acceptCustomerIngress(db, {
      id: availableIdentity.messageId,
      workspaceId,
      inboxId,
      threadId: customer.threadId,
      clientMessageId: availableClientId,
      workflowInstanceId: availableIdentity.workflowInstanceId,
      acceptedAt,
      originalText: "အဆင်ပြေပါသလား။",
      localeHint: "my-MM",
    });
    const processingPage = await pollMessages(customer);
    expect(processingPage.messages).toEqual([
      expect.objectContaining({ id: availableIdentity.messageId, state: "processing" }),
    ]);

    await markCustomerMessageProjected(db, {
      workspaceId,
      inboxId,
      threadId: customer.threadId,
      messageId: availableIdentity.messageId,
      generation: 1,
      transitionedAt: new Date(acceptedAt.getTime() + 1_000),
    });
    const availablePage = await pollMessages({
      ...customer,
      after: processingPage.nextCursor,
    });
    expect(availablePage.messages).toEqual([
      expect.objectContaining({ id: availableIdentity.messageId, state: "available" }),
    ]);

    const failedClientId = `client_failed_${crypto.randomUUID()}` as ClientMessageId;
    const failedIdentity = await deriveCustomerMessageIdentity({
      workspaceId,
      threadId: customer.threadId,
      clientMessageId: failedClientId,
    });
    await acceptCustomerIngress(db, {
      id: failedIdentity.messageId,
      workspaceId,
      inboxId,
      threadId: customer.threadId,
      clientMessageId: failedClientId,
      workflowInstanceId: failedIdentity.workflowInstanceId,
      acceptedAt: new Date(acceptedAt.getTime() + 2_000),
      originalText: "မအောင်မြင်သေးပါ။",
      localeHint: "my-MM",
    });
    const secondProcessingPage = await pollMessages({
      ...customer,
      after: availablePage.nextCursor,
    });
    expect(secondProcessingPage.messages).toEqual([
      expect.objectContaining({ id: failedIdentity.messageId, state: "processing" }),
    ]);

    await recordTerminalFailure(db, {
      workspaceId,
      inboxId,
      threadId: customer.threadId,
      messageId: failedIdentity.messageId,
      generation: 1,
      transitionedAt: new Date(acceptedAt.getTime() + 3_000),
      stage: "translation",
      failureCode: "translation_unavailable",
    });
    const failedPage = await pollMessages({
      ...customer,
      after: secondProcessingPage.nextCursor,
    });
    expect(failedPage.messages).toEqual([
      expect.objectContaining({ id: failedIdentity.messageId, state: "failed" }),
    ]);
  });

  it("recreates a failed customer Workflow with the same immutable ID and emits retry revisions", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const db = createDatabase(env.DB);
    const workspaceId = WorkspaceIdSchema.parse(TEST_TOPOLOGY.workspaceId);
    const inboxId = InboxIdSchema.parse(TEST_TOPOLOGY.inboxId);
    const clientMessageId = `client_retry_${crypto.randomUUID()}` as ClientMessageId;
    const identity = await deriveCustomerMessageIdentity({
      workspaceId,
      threadId: customer.threadId,
      clientMessageId,
    });
    const originalText = "တူညီတဲ့စာနဲ့ ပြန်ကြိုးစားပါ။";
    const acceptedAt = new Date("2026-08-25T11:30:00.000Z");
    await acceptCustomerIngress(db, {
      id: identity.messageId,
      workspaceId,
      inboxId,
      threadId: customer.threadId,
      clientMessageId,
      workflowInstanceId: identity.workflowInstanceId,
      acceptedAt,
      originalText,
      localeHint: "my-MM",
    });
    await recordTerminalFailure(db, {
      workspaceId,
      inboxId,
      threadId: customer.threadId,
      messageId: identity.messageId,
      generation: 1,
      transitionedAt: new Date(acceptedAt.getTime() + 1_000),
      stage: "translation",
      failureCode: "translation_unavailable",
    });

    const failedPage = await pollMessages(customer);
    expect(failedPage.messages.map((message) => [message.id, message.state])).toEqual([
      [identity.messageId, "processing"],
      [identity.messageId, "failed"],
    ]);

    const conflict = await sendCustomerMessage({
      ...customer,
      clientMessageId,
      text: "A different payload must not replace the failed one.",
    });
    expect(conflict.status).toBe(409);

    const restart = vi.fn(async () => undefined);
    const retainedInstance = {
      status: async () => ({ status: "errored" as const }),
      restart,
    } as unknown as WorkflowInstance;
    const retainedWorkflow = {
      createBatch: vi.fn(async () => [] as WorkflowInstance[]),
      get: vi.fn(async () => retainedInstance),
    } as unknown as ApiEnv["MESSAGE_WORKFLOW"];
    const retainedRetry = await createHttpApp().request(
      `/v1/threads/${customer.threadId}/messages`,
      {
        method: "POST",
        headers: authorizationHeaders(customer.sessionToken),
        body: JSON.stringify({ clientMessageId, text: originalText }),
      },
      createTestEnv({ MESSAGE_WORKFLOW: retainedWorkflow }),
    );
    expect(retainedRetry.status).toBe(202);
    expect(SendMessageResponseV1Schema.parse(await retainedRetry.json()).acceptance.status).toBe(
      "accepted",
    );
    expect(restart).toHaveBeenCalledOnce();

    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult({ name: "translate-message" }, incomingTranslation);
        await modifier.mockStepResult(
          { name: "project-customer-message-0" },
          { discordMessageId: "100000000000000093" },
        );
      });

      const retry = await sendCustomerMessage({
        ...customer,
        clientMessageId,
        text: originalText,
      });
      expect(retry.status).toBe(202);
      expect(SendMessageResponseV1Schema.parse(await retry.json()).acceptance).toMatchObject({
        messageId: identity.messageId,
        clientMessageId,
        status: "accepted",
      });

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("complete");
      const retryPage = await pollMessages({ ...customer, after: failedPage.nextCursor });
      expect(retryPage.messages.map((message) => [message.id, message.state])).toEqual([
        [identity.messageId, "processing"],
        [identity.messageId, "available"],
      ]);

      const canonical = await env.DB.prepare(
        "select accepted_at, processing_generation, processing_status from message where id = ?",
      )
        .bind(identity.messageId)
        .first<{
          accepted_at: number;
          processing_generation: number;
          processing_status: string;
        }>();
      expect(canonical).toEqual({
        accepted_at: acceptedAt.getTime(),
        processing_generation: 2,
        processing_status: "succeeded",
      });
    } finally {
      await workflows.dispose();
    }
  });

  it("projects the original when recreating a legacy translated customer workflow", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const db = createDatabase(env.DB);
    const workspaceId = WorkspaceIdSchema.parse(TEST_TOPOLOGY.workspaceId);
    const inboxId = InboxIdSchema.parse(TEST_TOPOLOGY.inboxId);
    const clientMessageId = `client_replay_${crypto.randomUUID()}` as ClientMessageId;
    const identity = await deriveCustomerMessageIdentity({
      workspaceId,
      threadId: customer.threadId,
      clientMessageId,
    });
    const originalText = "ပြန်ဖွင့်လို့ မရသေးပါ။";
    const canonical = {
      ...incomingTranslation,
      needsReview: true,
      translatedText: "The canonical persisted translation.",
    } satisfies TranslationResult;
    const laterCandidate = {
      ...incomingTranslation,
      translatedText: "A different translation from a recreated Workflow.",
    } satisfies TranslationResult;
    const firstAcceptedAt = new Date("2026-08-25T10:00:00.000Z");

    await acceptCustomerIngress(db, {
      id: identity.messageId,
      workspaceId,
      inboxId,
      threadId: customer.threadId,
      clientMessageId,
      workflowInstanceId: identity.workflowInstanceId,
      acceptedAt: firstAcceptedAt,
      originalText,
      localeHint: "my-MM",
    });
    await storeCustomerTranslation(db, {
      id: translationRecordId(
        identity.messageId,
        canonical.targetLanguage,
        canonical.promptVersion,
      ),
      workspaceId,
      inboxId,
      threadId: customer.threadId,
      messageId: identity.messageId,
      generation: 1,
      sourceLanguage: canonical.sourceLanguage,
      targetLanguage: canonical.targetLanguage,
      translatedText: canonical.translatedText,
      promptVersion: canonical.promptVersion,
      provider: canonical.provider,
      model: canonical.modelId,
      isPassThrough: canonical.passThrough,
      mixedLanguage: canonical.mixedLanguage,
      needsReview: canonical.needsReview,
      translatedAt: firstAcceptedAt,
    });
    const thread = await env.DB.prepare("select visitor_id from thread where id = ?")
      .bind(customer.threadId)
      .first<{ visitor_id: string }>();
    if (thread === null) throw new Error("Expected the customer thread fixture");

    const postedBodies: unknown[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (request, init) => {
      const url =
        typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
      if (init?.method === "GET" && url.endsWith("/messages?limit=100")) {
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (init?.method === "POST" && url.endsWith("/messages")) {
        if (typeof init.body !== "string") throw new Error("Expected a JSON Discord body");
        const body = JSON.parse(init.body) as { content: string; nonce: string };
        postedBodies.push(body);
        return new Response(
          JSON.stringify({
            id: "100000000000000094",
            channel_id: TEST_TOPOLOGY.discordThreadId,
            content: body.content,
            nonce: body.nonce,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected outbound request: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetch);

    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult({ name: "translate-message" }, laterCandidate);
      });
      await env.MESSAGE_WORKFLOW.create({
        id: identity.workflowInstanceId,
        params: {
          schema: "respondkit.workflow-message/1",
          direction: "customer_to_operator",
          workspaceId,
          inboxId,
          threadId: customer.threadId,
          visitorId: thread.visitor_id,
          messageId: identity.messageId,
          workflowInstanceId: identity.workflowInstanceId,
          acceptedAt: new Date(firstAcceptedAt.getTime() + 60_000).toISOString(),
          clientMessageId,
          originalText,
          localeHint: "my-MM",
          context: {},
        },
      });

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("complete");
      expect(postedBodies).toEqual([
        expect.objectContaining({
          content: expect.stringContaining(originalText),
        }),
      ]);
      expect(JSON.stringify(postedBodies)).not.toContain(laterCandidate.translatedText);
      expect(JSON.stringify(postedBodies)).not.toContain("Translation needs review");
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });
});

describe("signed Discord interaction ingress", () => {
  let publicKeyHex: string;
  let privateKey: CryptoKey;

  beforeAll(async () => {
    const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    privateKey = keyPair.privateKey;
    publicKeyHex = bytesToHex(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  });

  function bytesToHex(bytes: ArrayBuffer): string {
    return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function signedRequest(rawBody: string) {
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const signature = await crypto.subtle.sign(
      "Ed25519",
      privateKey,
      new TextEncoder().encode(timestamp + rawBody),
    );
    return {
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": bytesToHex(signature),
        "x-signature-timestamp": timestamp,
      },
      publicKeyHex,
    };
  }

  function commandPayload(
    interactionId: string,
    command: string,
    options: readonly { readonly name: string; readonly value: string }[],
  ): Record<string, unknown> {
    return {
      id: interactionId,
      application_id: TEST_TOPOLOGY.applicationId,
      type: 2,
      token: "must-never-be-persisted",
      guild_id: TEST_TOPOLOGY.guildId,
      channel_id: TEST_TOPOLOGY.discordThreadId,
      channel: {
        id: TEST_TOPOLOGY.discordThreadId,
        type: 11,
        parent_id: TEST_TOPOLOGY.forumChannelId,
      },
      member: {
        user: { id: TEST_TOPOLOGY.operatorId },
        roles: [TEST_TOPOLOGY.operatorRoleId],
      },
      data: {
        type: 1,
        name: command,
        options: options.map((option) => ({ type: 3, ...option })),
      },
    };
  }

  async function sendSignedCommand(
    payload: Record<string, unknown>,
    executionContext = createExecutionContext(),
  ) {
    const rawBody = JSON.stringify(payload);
    const signed = await signedRequest(rawBody);
    return createHttpApp().request(
      "/v1/discord/interactions",
      { method: "POST", headers: signed.headers, body: rawBody },
      createTestEnv({ DISCORD_PUBLIC_KEY: signed.publicKeyHex }),
      executionContext,
    );
  }

  it("accepts signed PING bytes and rejects a body changed after signing", async () => {
    const rawBody = JSON.stringify({
      id: snowflakeAt(),
      application_id: TEST_TOPOLOGY.applicationId,
      type: 1,
      token: "ping-token",
    });
    const signed = await signedRequest(rawBody);
    const valid = await createHttpApp().request(
      "/v1/discord/interactions",
      { method: "POST", headers: signed.headers, body: rawBody },
      createTestEnv({ DISCORD_PUBLIC_KEY: signed.publicKeyHex }),
    );
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toEqual({ type: 1 });

    const changed = await createHttpApp().request(
      "/v1/discord/interactions",
      { method: "POST", headers: signed.headers, body: `${rawBody} ` },
      createTestEnv({ DISCORD_PUBLIC_KEY: signed.publicKeyHex }),
    );
    expect(changed.status).toBe(401);
  });

  it("sends /reply as written even when translation is unavailable", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const privateUpdates: Array<{ content: string; components?: unknown[] }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (request, init) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (
          init?.method === "PATCH" &&
          url.includes("/webhooks/") &&
          typeof init.body === "string"
        ) {
          privateUpdates.push(JSON.parse(init.body) as { content: string; components?: unknown[] });
          return Response.json({});
        }
        return Response.json([]);
      }),
    );
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.mockStepError(
          { name: "translate-message" },
          new Error("Must not call Gemini"),
        );
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000079" },
        );
      });
      const reference = snowflakeAt();
      const response = await sendSignedCommand(
        commandPayload(reference, "reply", [{ name: "message", value: "  Send exactly this.  " }]),
      );
      expect(await response.json()).toMatchObject({
        data: { content: expect.stringContaining("delivery as written") },
      });
      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("complete");
      expect(privateUpdates).toEqual([
        expect.objectContaining({ content: "Reply sent to the customer.", components: [] }),
      ]);
      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({ text: "  Send exactly this.  ", state: "available" }),
      ]);
      expect(
        await env.DB.prepare("SELECT count(*) AS count FROM message_translation").first(),
      ).toEqual({ count: 0 });
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("does not treat browser locale as a known customer translation language", async () => {
    const customer = await createCustomerFixture({ locale: "my-MM" });
    await seedReadyDiscordThread(customer.threadId);
    const response = await sendSignedCommand(
      commandPayload(snowflakeAt(), "reply", [
        { name: "message", value: "Hello" },
        { name: "translate", value: "customer" },
      ]),
    );
    expect(await response.json()).toMatchObject({
      data: { content: expect.stringContaining("Customer language is unknown") },
    });
    expect(await env.DB.prepare("SELECT count(*) AS count FROM message").first()).toEqual({
      count: 0,
    });
  });

  it("records a language named in /reply as the customer's, which translate:customer then uses", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async () => Response.json({})),
    );
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult({ name: "translate-message" }, outgoingTranslation);
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000078" },
        );
      });
      const named = await sendSignedCommand(
        commandPayload(snowflakeAt(), "reply", [
          { name: "message", value: "Please reopen the app." },
          { name: "translate", value: "Burmese" },
        ]),
      );
      expect(await named.json()).toMatchObject({
        data: { content: expect.stringContaining("Queued for translation and delivery.") },
      });
      expect(
        await env.DB.prepare("SELECT customer_language FROM thread WHERE id = ?")
          .bind(customer.threadId)
          .first("customer_language"),
      ).toBe("my");
      const reference = snowflakeAt(Date.now() + 1000);
      const remembered = await sendSignedCommand(
        commandPayload(reference, "reply", [
          { name: "message", value: "Then try again." },
          { name: "translate", value: "customer" },
        ]),
      );
      expect(await remembered.json()).toMatchObject({
        data: { content: expect.stringContaining("Queued for translation and delivery.") },
      });
      expect(
        await env.DB.prepare(
          "SELECT reply_translation, reply_translation_request FROM message WHERE original_text = ?",
        )
          .bind("Then try again.")
          .first(),
      ).toEqual({ reply_translation: "my", reply_translation_request: "customer" });
      for (const instance of await workflows.get()) await instance.waitForStatus("complete");
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("translates an authorized /reply and publishes it to the customer transcript", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const privateUpdates: Array<{ content: string; components?: unknown[] }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (request, init) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (
          init?.method === "PATCH" &&
          url.includes("/webhooks/") &&
          typeof init.body === "string"
        ) {
          privateUpdates.push(JSON.parse(init.body) as { content: string; components?: unknown[] });
          return Response.json({});
        }
        return Response.json([]);
      }),
    );
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult({ name: "translate-message" }, outgoingTranslation);
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000097" },
        );
      });

      const interactionId = snowflakeAt(Date.now(), 11n);
      const response = await sendSignedCommand(
        commandPayload(interactionId, "reply", [
          { name: "message", value: "Please reopen the app." },
          { name: "translate", value: "my-MM" },
        ]),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        type: 4,
        data: {
          content: expect.stringContaining("Queued for translation and delivery."),
          flags: 64,
          allowed_mentions: { parse: [] },
        },
      });

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("complete");
      expect(privateUpdates).toEqual([
        expect.objectContaining({ content: "Reply sent to the customer.", components: [] }),
      ]);
      const transcript = await pollMessages(customer);
      expect(transcript.messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: outgoingTranslation.translatedText,
          language: "my-MM",
          state: "available",
        }),
      ]);

      const receipt = await env.DB.prepare(
        "select command_name, normalized_message, operator_role_ids from discord_interaction where interaction_id = ?",
      )
        .bind(interactionId)
        .first<{
          command_name: string;
          normalized_message: string;
          operator_role_ids: string;
        }>();
      expect(receipt).toEqual({
        command_name: "reply",
        normalized_message: "Please reopen the app.",
        operator_role_ids: JSON.stringify([TEST_TOPOLOGY.operatorRoleId]),
      });

      const replay = await sendSignedCommand(
        commandPayload(interactionId, "reply", [
          { name: "message", value: "Please reopen the app." },
          { name: "translate", value: "my-MM" },
        ]),
      );
      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toMatchObject({
        data: { content: "Reply already sent to the customer." },
      });
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("lets a failed /reply be sent again with /reply without posting a public failure card", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const privateUpdates: string[] = [];
    const publicThreadPosts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (request, init) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (
          init?.method === "PATCH" &&
          url.includes("/webhooks/") &&
          typeof init.body === "string"
        ) {
          const body = JSON.parse(init.body) as { content: string };
          privateUpdates.push(body.content);
          return Response.json({});
        }
        if (init?.method === "POST" && url.includes("/channels/") && url.endsWith("/messages")) {
          publicThreadPosts.push(typeof init.body === "string" ? init.body : "");
          return Response.json({});
        }
        return Response.json([]);
      }),
    );

    const failedWorkflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await failedWorkflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepError(
          { name: "translate-message" },
          new Error("Translation provider unavailable"),
        );
      });

      const firstResponse = await sendSignedCommand(
        commandPayload(snowflakeAt(Date.now(), 51n), "reply", [
          { name: "message", value: "Please try exporting again." },
          { name: "translate", value: "my-MM" },
        ]),
      );
      expect(firstResponse.status).toBe(200);
      await (await oneCapturedWorkflow(failedWorkflows)).waitForStatus("errored");
      expect(publicThreadPosts).toEqual([]);
      expect(
        await env.DB.prepare(
          "SELECT count(*) n FROM discord_message WHERE projection_kind='failure_audit'",
        ).first("n"),
      ).toBe(0);
      expect(privateUpdates.at(-1)).toBe("Reply not sent. Send it again with /reply.");
      expect((await pollMessages(customer)).messages).toEqual([]);
    } finally {
      await failedWorkflows.dispose();
    }

    const retryWorkflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await retryWorkflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult({ name: "translate-message" }, outgoingTranslation);
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000091" },
        );
      });

      const secondResponse = await sendSignedCommand(
        commandPayload(snowflakeAt(Date.now() + 1_000, 52n), "reply", [
          { name: "message", value: "Please try exporting again." },
          { name: "translate", value: "my-MM" },
        ]),
      );
      expect(secondResponse.status).toBe(200);
      await (await oneCapturedWorkflow(retryWorkflows)).waitForStatus("complete");
      expect(privateUpdates.at(-1)).toBe("Reply sent to the customer.");
      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: outgoingTranslation.translatedText,
          state: "available",
        }),
      ]);
      for (const message of privateUpdates) {
        expect(message).not.toMatch(/\/(status|retry|agent|approve)\b/i);
      }
    } finally {
      vi.unstubAllGlobals();
      await retryWorkflows.dispose();
    }
  });

  it("refuses interactions for removed commands and buttons as unknown", async () => {
    const removedSlash = [
      commandPayload(snowflakeAt(Date.now(), 61n), "status", [
        { name: "reference", value: "100000000000000001" },
      ]),
      commandPayload(snowflakeAt(Date.now(), 62n), "retry", [
        { name: "reference", value: "100000000000000001" },
        { name: "message", value: "Hello" },
      ]),
      commandPayload(snowflakeAt(Date.now(), 63n), "agent", [{ name: "message", value: "Steer" }]),
      commandPayload(snowflakeAt(Date.now(), 64n), "approve", [
        { name: "id", value: "100000000000000001" },
      ]),
    ];
    for (const payload of removedSlash) {
      const response = await sendSignedCommand(payload);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        data: { content: "Unknown Discord command" },
      });
    }

    const removedMessageCommand = {
      ...commandPayload(snowflakeAt(Date.now(), 65n), "reply", []),
      data: { type: 3, name: "Approve draft", target_id: "100000000000000081" },
    };
    const msgRes = await sendSignedCommand(removedMessageCommand);
    expect(msgRes.status).toBe(400);
    await expect(msgRes.json()).resolves.toMatchObject({
      data: { content: "Unknown Discord command" },
    });

    for (const customId of [
      `agent:approve:msg_agent_${"a".repeat(64)}`,
      `agent:translate:msg_agent_${"a".repeat(64)}:1`,
    ]) {
      const buttonPayload = {
        ...commandPayload(snowflakeAt(Date.now(), 66n), "reply", []),
        type: 3,
        data: { custom_id: customId, component_type: 2 },
      };
      const btnRes = await sendSignedCommand(buttonPayload);
      expect(btnRes.status).toBe(400);
      await expect(btnRes.json()).resolves.toMatchObject({
        data: { content: "Unknown Discord interaction" },
      });
    }
  });

  it("fails an operator reply closed when translation never succeeds", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const privateUpdates: string[] = [];
    const publicThreadPosts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (request, init) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (
          init?.method === "PATCH" &&
          url.includes("/webhooks/") &&
          typeof init.body === "string"
        ) {
          privateUpdates.push((JSON.parse(init.body) as { content: string }).content);
          return Response.json({});
        }
        if (init?.method === "POST" && url.includes("/channels/") && url.endsWith("/messages")) {
          publicThreadPosts.push(typeof init.body === "string" ? init.body : "");
          return Response.json({});
        }
        return Response.json([]);
      }),
    );
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepError(
          { name: "translate-message" },
          new Error("Translation provider unavailable"),
        );
      });

      const interactionId = snowflakeAt(Date.now(), 31n);
      const response = await sendSignedCommand(
        commandPayload(interactionId, "reply", [
          { name: "message", value: "This must not leak to the customer in English." },
          { name: "translate", value: "my-MM" },
        ]),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { content: expect.stringContaining("Queued for translation and delivery.") },
      });

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("errored");
      expect(privateUpdates).toEqual(["Reply not sent. Send it again with /reply."]);
      expect(publicThreadPosts).toEqual([]);
      expect((await pollMessages(customer)).messages).toEqual([]);
      expect(await env.DB.prepare("SELECT count(*) n FROM discord_message").first("n")).toBe(0);

      const row = await env.DB.prepare(
        "select m.processing_status, m.customer_availability, m.customer_visible_text, m.failure_stage from message m join discord_interaction i on i.message_id = m.id where i.interaction_id = ?",
      )
        .bind(interactionId)
        .first<{
          processing_status: string;
          customer_availability: string;
          customer_visible_text: string | null;
          failure_stage: string;
        }>();
      expect(row).toEqual({
        processing_status: "failed",
        customer_availability: "not_available",
        customer_visible_text: null,
        failure_stage: "translation",
      });
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("keeps a published reply available when only its Discord audit fails without posting a public failure card", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const privateUpdates: string[] = [];
    const publicThreadPosts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (request, init) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (
          init?.method === "PATCH" &&
          url.includes("/webhooks/") &&
          typeof init.body === "string"
        ) {
          privateUpdates.push((JSON.parse(init.body) as { content: string }).content);
          return Response.json({});
        }
        if (init?.method === "POST" && url.includes("/channels/") && url.endsWith("/messages")) {
          publicThreadPosts.push(typeof init.body === "string" ? init.body : "");
          return Response.json({});
        }
        return Response.json([]);
      }),
    );
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult({ name: "translate-message" }, outgoingTranslation);
        await modifier.mockStepError(
          { name: "post-available-audit-0" },
          new Error("Discord audit unavailable"),
        );
      });

      const interactionId = snowflakeAt(Date.now(), 41n);
      const response = await sendSignedCommand(
        commandPayload(interactionId, "reply", [
          { name: "message", value: "Please reopen the app." },
          { name: "translate", value: "my-MM" },
        ]),
      );
      expect(response.status).toBe(200);

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("errored");
      expect(privateUpdates).toEqual([
        "Reply sent to the customer, but posting the thread copy failed. Do not resend.",
      ]);
      expect(publicThreadPosts).toEqual([]);
      expect(
        await env.DB.prepare(
          "SELECT count(*) n FROM discord_message WHERE projection_kind='failure_audit'",
        ).first("n"),
      ).toBe(0);
      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: outgoingTranslation.translatedText,
          state: "available",
        }),
      ]);

      const row = await env.DB.prepare(
        "select m.processing_status, m.customer_availability, m.discord_audit_status, m.failure_stage from message m join discord_interaction i on i.message_id = m.id where i.interaction_id = ?",
      )
        .bind(interactionId)
        .first<{
          processing_status: string;
          customer_availability: string;
          discord_audit_status: string;
          failure_stage: string;
        }>();
      expect(row).toEqual({
        processing_status: "failed",
        customer_availability: "available",
        discord_audit_status: "failed",
        failure_stage: "discord_audit",
      });
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("delivers the private review preview and confirm button from the workflow and clears it on confirmation", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const webhookPatches: Array<{ url: string; content: string; components: unknown[] }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (request, init) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (
          init?.method === "PATCH" &&
          url.includes("/webhooks/") &&
          typeof init.body === "string"
        ) {
          const parsed = JSON.parse(init.body) as { content: string; components?: unknown[] };
          webhookPatches.push({
            url,
            content: parsed.content,
            components: parsed.components ?? [],
          });
          return Response.json({});
        }
        return Response.json([]);
      }),
    );

    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult(
          { name: "translate-message" },
          { ...outgoingTranslation, needsReview: true },
        );
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000098" },
        );
      });

      const interactionId = snowflakeAt(Date.now(), 71n);
      const replyPayload = {
        ...commandPayload(interactionId, "reply", [
          { name: "message", value: "Please reopen the app." },
          { name: "translate", value: "my-MM" },
        ]),
        token: "reply-preview-token",
      };
      const response = await sendSignedCommand(replyPayload);
      expect(response.status).toBe(200);

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStepResult({ name: "notify-reply-review-1" });
      expect(webhookPatches).toContainEqual(
        expect.objectContaining({
          url: expect.stringContaining("/reply-preview-token/messages/@original"),
          content: expect.stringContaining("Review required · reply not sent"),
          components: [
            {
              type: 1,
              components: [
                expect.objectContaining({
                  label: "Send this translation",
                  custom_id: `confirm-translation:${interactionId}:1`,
                }),
              ],
            },
          ],
        }),
      );
      expect((await pollMessages(customer)).messages).toEqual([]);

      const confirmCtx = createExecutionContext();
      const confirmRes = await sendSignedCommand(
        {
          ...commandPayload(snowflakeAt(Date.now() + 1_000, 72n), "reply", []),
          type: 3,
          token: "confirm-button-token",
          data: { custom_id: `confirm-translation:${interactionId}:1`, component_type: 2 },
        },
        confirmCtx,
      );
      expect(confirmRes.status).toBe(200);
      await instance.waitForStatus("complete");
      await waitOnExecutionContext(confirmCtx);

      expect(webhookPatches).toContainEqual(
        expect.objectContaining({
          url: expect.stringContaining("/reply-preview-token/messages/@original"),
          content: "Reply sent to the customer.",
          components: [],
        }),
      );
      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: outgoingTranslation.translatedText,
          state: "available",
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("never mentions removed commands when replaying a /reply across all message states", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const interactionId = snowflakeAt(Date.now(), 81n);
    const payload = commandPayload(interactionId, "reply", [
      { name: "message", value: "Replay test reply." },
    ]);
    const identity = await deriveOperatorMessageIdentity({
      applicationId: TEST_TOPOLOGY.applicationId,
      interactionId,
    });
    await acceptReplyIngress(createDatabase(env.DB), {
      integrationId: TEST_TOPOLOGY.integrationId,
      interactionId,
      workspaceId: WorkspaceIdSchema.parse(TEST_TOPOLOGY.workspaceId),
      inboxId: InboxIdSchema.parse(TEST_TOPOLOGY.inboxId),
      threadId: customer.threadId,
      ...identity,
      applicationId: TEST_TOPOLOGY.applicationId,
      guildId: TEST_TOPOLOGY.guildId,
      discordThreadId: TEST_TOPOLOGY.discordThreadId,
      operatorUserId: TEST_TOPOLOGY.operatorId,
      operatorRoleIds: [TEST_TOPOLOGY.operatorRoleId],
      acceptedAt: new Date(),
      originalEnglishText: "Replay test reply.",
      replyTranslation: "off",
      replyTranslationRequest: "off",
    });

    const activeWorkflow = {
      createBatch: vi.fn(async () => []),
      get: vi.fn(async () => ({
        status: vi.fn(async () => ({ status: "running" })),
      })),
    } as unknown as ApiEnv["MESSAGE_WORKFLOW"];
    const cases = [
      {
        sql: "UPDATE message SET processing_status='processing', customer_availability='pending' WHERE id=?",
        expected: "Reply is still sending.",
        useActiveWorkflow: true,
      },
      {
        sql: "UPDATE message SET processing_status='succeeded', customer_availability='available', discord_audit_status='projected' WHERE id=?",
        expected: "Reply already sent to the customer.",
        useActiveWorkflow: false,
      },
      {
        sql: "UPDATE message SET processing_status='failed', customer_availability='available', discord_audit_status='failed', failure_stage='discord_audit' WHERE id=?",
        expected:
          "Reply already sent to the customer, but posting the thread copy failed. Do not resend.",
        useActiveWorkflow: false,
      },
      {
        sql: "UPDATE message SET processing_status='failed', customer_availability='not_available', failure_stage='translation' WHERE id=?",
        expected: "Reply was not sent. Send it again with /reply.",
        useActiveWorkflow: false,
      },
    ];
    for (const entry of cases) {
      await env.DB.prepare(entry.sql).bind(identity.messageId).run();
      let replay: Response;
      if (entry.useActiveWorkflow) {
        const rawBody = JSON.stringify(payload);
        const signed = await signedRequest(rawBody);
        replay = await createHttpApp().request(
          "/v1/discord/interactions",
          { method: "POST", headers: signed.headers, body: rawBody },
          createTestEnv({
            DISCORD_PUBLIC_KEY: signed.publicKeyHex,
            MESSAGE_WORKFLOW: activeWorkflow,
          }),
        );
      } else {
        replay = await sendSignedCommand(payload);
      }
      expect(replay.status).toBe(200);
      const body = (await replay.json()) as { data: { content: string } };
      expect(body.data.content).toBe(entry.expected);
      expect(body.data.content).not.toMatch(/\/(status|retry|agent|approve)\b/i);
    }
  });

  it("warns privately not to resend when enqueue-reply-email fails after customer publication", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const privateUpdates: string[] = [];
    const publicThreadPosts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (request, init) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (
          init?.method === "PATCH" &&
          url.includes("/webhooks/") &&
          typeof init.body === "string"
        ) {
          privateUpdates.push((JSON.parse(init.body) as { content: string }).content);
          return Response.json({});
        }
        if (init?.method === "POST" && url.includes("/channels/") && url.endsWith("/messages")) {
          publicThreadPosts.push(typeof init.body === "string" ? init.body : "");
          return Response.json({});
        }
        return Response.json([]);
      }),
    );
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepError(
          { name: "enqueue-reply-email" },
          new Error("Reply email queue failure"),
        );
      });

      const interactionId = snowflakeAt(Date.now(), 85n);
      const response = await sendSignedCommand(
        commandPayload(interactionId, "reply", [{ name: "message", value: "Published once." }]),
      );
      expect(response.status).toBe(200);

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("errored");
      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: "Published once.",
          state: "available",
        }),
      ]);
      expect(privateUpdates).toEqual([
        "Reply sent to the customer, but posting the thread copy failed. Do not resend.",
      ]);
      expect(publicThreadPosts).toEqual([]);
      expect(
        await env.DB.prepare(
          "SELECT count(*) n FROM discord_message WHERE projection_kind='failure_audit'",
        ).first("n"),
      ).toBe(0);
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("recovers the private review preview on the original interaction after three 503s with zero transport replay", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    let previewAttempts = 0;
    const webhookPatches: Array<{ url: string; content: string; components: unknown[] }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (request, init) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (
          init?.method === "PATCH" &&
          url.includes("/webhooks/") &&
          typeof init.body === "string"
        ) {
          if (url.includes("/outage-preview-token/")) {
            previewAttempts += 1;
            if (previewAttempts <= 3) {
              return new Response("Discord unavailable", { status: 503 });
            }
          }
          const parsed = JSON.parse(init.body) as { content: string; components?: unknown[] };
          webhookPatches.push({
            url,
            content: parsed.content,
            components: parsed.components ?? [],
          });
          return Response.json({});
        }
        return Response.json([]);
      }),
    );

    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult(
          { name: "translate-message" },
          { ...outgoingTranslation, needsReview: true },
        );
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000099" },
        );
      });

      const interactionId = snowflakeAt(Date.now(), 86n);
      const replyPayload = {
        ...commandPayload(interactionId, "reply", [
          { name: "message", value: "Please reopen the app." },
          { name: "translate", value: "my-MM" },
        ]),
        token: "outage-preview-token",
      };
      const initial = await sendSignedCommand(replyPayload);
      expect(initial.status).toBe(200);

      // No transport replay: durable workflow retries deliver the preview once Discord recovers.
      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStepResult({ name: "notify-reply-review-1" });
      expect(previewAttempts).toBe(4);
      expect(webhookPatches).toContainEqual(
        expect.objectContaining({
          url: expect.stringContaining("/outage-preview-token/messages/@original"),
          content: expect.stringContaining("Review required · reply not sent"),
          components: [
            {
              type: 1,
              components: [
                expect.objectContaining({
                  label: "Send this translation",
                  custom_id: `confirm-translation:${interactionId}:1`,
                }),
              ],
            },
          ],
        }),
      );

      const confirmCtx = createExecutionContext();
      const confirmRes = await sendSignedCommand(
        {
          ...commandPayload(snowflakeAt(Date.now() + 1_000, 87n), "reply", []),
          type: 3,
          token: "recovered-confirm-token",
          data: { custom_id: `confirm-translation:${interactionId}:1`, component_type: 2 },
        },
        confirmCtx,
      );
      expect(confirmRes.status).toBe(200);
      await instance.waitForStatus("complete");
      await waitOnExecutionContext(confirmCtx);

      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: outgoingTranslation.translatedText,
          state: "available",
        }),
      ]);
      expect(webhookPatches).toContainEqual(
        expect.objectContaining({
          url: expect.stringContaining("/recovered-confirm-token/messages/@original"),
          content: "Reply sent to the customer.",
        }),
      );
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("fails closed when the review preview webhook never recovers so a fresh /reply delivers once", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    let webhookAvailable = false;
    const webhookPatches: Array<{ url: string; content: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (request, init) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (
          init?.method === "PATCH" &&
          url.includes("/webhooks/") &&
          typeof init.body === "string"
        ) {
          if (!webhookAvailable) {
            return new Response("Discord unavailable", { status: 503 });
          }
          webhookPatches.push({
            url,
            content: (JSON.parse(init.body) as { content: string }).content,
          });
          return Response.json({});
        }
        return Response.json([]);
      }),
    );

    const failedWorkflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await failedWorkflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult(
          { name: "translate-message" },
          { ...outgoingTranslation, needsReview: true },
        );
      });

      const failedInteractionId = snowflakeAt(Date.now(), 88n);
      const first = await sendSignedCommand({
        ...commandPayload(failedInteractionId, "reply", [
          { name: "message", value: "Please reopen the app." },
          { name: "translate", value: "my-MM" },
        ]),
        token: "permanently-down-preview-token",
      });
      expect(first.status).toBe(200);

      // Must fail closed after exhausting retries instead of waiting 24h for an invisible button.
      await (await oneCapturedWorkflow(failedWorkflows)).waitForStatus("errored");
      expect((await pollMessages(customer)).messages).toEqual([]);
      const failedRow = await env.DB.prepare(
        "SELECT m.processing_status, m.customer_availability FROM message m JOIN discord_interaction i ON i.message_id = m.id WHERE i.interaction_id = ?",
      )
        .bind(failedInteractionId)
        .first<{ processing_status: string; customer_availability: string }>();
      expect(failedRow).toEqual({
        processing_status: "failed",
        customer_availability: "not_available",
      });
    } finally {
      await failedWorkflows.dispose();
    }

    // Once Discord recovers, a fresh /reply (new interaction ID) delivers once without duplicates.
    webhookAvailable = true;
    const retryWorkflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await retryWorkflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult({ name: "translate-message" }, outgoingTranslation);
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000102" },
        );
      });
      const fresh = await sendSignedCommand({
        ...commandPayload(snowflakeAt(Date.now() + 1_000, 89n), "reply", [
          { name: "message", value: "Please reopen the app." },
          { name: "translate", value: "my-MM" },
        ]),
        token: "fresh-reply-after-outage-token",
      });
      expect(fresh.status).toBe(200);
      await (await oneCapturedWorkflow(retryWorkflows)).waitForStatus("complete");
      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: outgoingTranslation.translatedText,
          state: "available",
        }),
      ]);
      expect(webhookPatches).toContainEqual(
        expect.objectContaining({
          url: expect.stringContaining("/fresh-reply-after-outage-token/messages/@original"),
          content: "Reply sent to the customer.",
        }),
      );
    } finally {
      vi.unstubAllGlobals();
      await retryWorkflows.dispose();
    }
  });

  it("recovers an orphaned /reply whose initial workflow dispatch failed before creation", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const privateUpdates: Array<{ url: string; content: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (request, init) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (
          init?.method === "PATCH" &&
          url.includes("/webhooks/") &&
          typeof init.body === "string"
        ) {
          privateUpdates.push({
            url,
            content: (JSON.parse(init.body) as { content: string }).content,
          });
          return Response.json({});
        }
        return Response.json([]);
      }),
    );

    const interactionId = snowflakeAt(Date.now(), 91n);
    const payload = {
      ...commandPayload(interactionId, "reply", [
        { name: "message", value: "Checking ambiguous start." },
      ]),
      token: "ambiguous-start-token",
    };
    const capturedParams: unknown[] = [];
    const flakyWorkflow = {
      createBatch: vi.fn(async (items: Array<{ id: string; params: unknown }>) => {
        capturedParams.push(items[0]?.params);
        throw new Error("Transient workflow dispatch error");
      }),
      get: vi.fn(async () => {
        throw new Error("Instance lookup unavailable");
      }),
    } as unknown as ApiEnv["MESSAGE_WORKFLOW"];

    const rawBody = JSON.stringify(payload);
    const signed = await signedRequest(rawBody);
    const first = await createHttpApp().request(
      "/v1/discord/interactions",
      { method: "POST", headers: signed.headers, body: rawBody },
      createTestEnv({
        DISCORD_PUBLIC_KEY: signed.publicKeyHex,
        MESSAGE_WORKFLOW: flakyWorkflow,
      }),
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { data: { content: string } };
    expect(firstBody.data.content).toBe(
      "Reply delivery could not be confirmed. Check the thread before sending again with /reply.",
    );
    expect(firstBody.data.content).not.toMatch(/\/(status|retry|agent|approve)\b/i);
    expect(capturedParams[0]).toMatchObject({
      discord: { interactionToken: "ambiguous-start-token" },
    });

    // Redelivering the same interaction reconciles and starts the missing workflow once.
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000101" },
        );
      });
      const recovered = await sendSignedCommand({
        ...payload,
        token: "recovered-dispatch-token",
      });
      expect(recovered.status).toBe(200);
      await expect(recovered.json()).resolves.toMatchObject({
        data: { content: "Queued for delivery as written." },
      });

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("complete");
      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: "Checking ambiguous start.",
          state: "available",
        }),
      ]);
      expect(privateUpdates).toEqual([
        expect.objectContaining({
          url: expect.stringContaining("/recovered-dispatch-token/messages/@original"),
          content: "Reply sent to the customer.",
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("lets a fresh /reply deliver once after an earlier acceptance_unknown dispatch failure", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const privateUpdates: Array<{ url: string; content: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (request, init) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (
          init?.method === "PATCH" &&
          url.includes("/webhooks/") &&
          typeof init.body === "string"
        ) {
          privateUpdates.push({
            url,
            content: (JSON.parse(init.body) as { content: string }).content,
          });
          return Response.json({});
        }
        return Response.json([]);
      }),
    );

    const flakyWorkflow = {
      createBatch: vi.fn(async () => {
        throw new Error("Transient workflow dispatch error");
      }),
      get: vi.fn(async () => {
        throw new Error("Instance lookup unavailable");
      }),
    } as unknown as ApiEnv["MESSAGE_WORKFLOW"];

    const firstRaw = JSON.stringify({
      ...commandPayload(snowflakeAt(Date.now(), 92n), "reply", [
        { name: "message", value: "Fresh send after ambiguity." },
      ]),
      token: "orphaned-first-token",
    });
    const signed = await signedRequest(firstRaw);
    const first = await createHttpApp().request(
      "/v1/discord/interactions",
      { method: "POST", headers: signed.headers, body: firstRaw },
      createTestEnv({
        DISCORD_PUBLIC_KEY: signed.publicKeyHex,
        MESSAGE_WORKFLOW: flakyWorkflow,
      }),
    );
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      data: {
        content:
          "Reply delivery could not be confirmed. Check the thread before sending again with /reply.",
      },
    });

    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000103" },
        );
      });
      const fresh = await sendSignedCommand({
        ...commandPayload(snowflakeAt(Date.now() + 1_000, 93n), "reply", [
          { name: "message", value: "Fresh send after ambiguity." },
        ]),
        token: "fresh-second-token",
      });
      expect(fresh.status).toBe(200);
      await expect(fresh.json()).resolves.toMatchObject({
        data: { content: "Queued for delivery as written." },
      });

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("complete");
      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: "Fresh send after ambiguity.",
          state: "available",
        }),
      ]);
      expect(privateUpdates).toEqual([
        expect.objectContaining({
          url: expect.stringContaining("/fresh-second-token/messages/@original"),
          content: "Reply sent to the customer.",
        }),
      ]);
      expect(
        await env.DB.prepare(
          "SELECT count(*) n FROM message WHERE thread_id = ? AND direction = 'operator_to_customer'",
        )
          .bind(customer.threadId)
          .first("n"),
      ).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("deduplicates a fresh /reply when an earlier acceptance_unknown workflow is still translating so the customer gets one message", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    let translationStartedCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (request, init) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (url.includes("generativelanguage.googleapis.com")) {
          translationStartedCount += 1;
          await new Promise((resolve) => setTimeout(resolve, 600));
          return Response.json({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      text: JSON.stringify({
                        sourceLanguage: "en",
                        targetLanguage: "my-MM",
                        translatedText: outgoingTranslation.translatedText,
                        mixedLanguage: false,
                        needsReview: false,
                        ambiguityNotes: [],
                      }),
                    },
                  ],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 10,
              totalTokenCount: 20,
            },
          });
        }
        if (init?.method === "PATCH" && url.includes("/webhooks/")) {
          return Response.json({});
        }
        return Response.json([]);
      }),
    );

    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000104" },
        );
      });

      const ambiguousWorkflow = {
        createBatch: vi.fn(async (items: WorkflowInstanceCreateOptions<unknown>[]) => {
          await env.MESSAGE_WORKFLOW.createBatch(
            items as Parameters<ApiEnv["MESSAGE_WORKFLOW"]["createBatch"]>[0],
          );
          throw new Error("Lost response after workflow started");
        }),
        get: vi.fn(async () => {
          throw new Error("Status lookup unavailable during ambiguity");
        }),
      } as unknown as ApiEnv["MESSAGE_WORKFLOW"];

      const firstRaw = JSON.stringify({
        ...commandPayload(snowflakeAt(Date.now(), 94n), "reply", [
          { name: "message", value: "Delayed translation reply." },
          { name: "translate", value: "my-MM" },
        ]),
        token: "delayed-first-token",
      });
      const signed = await signedRequest(firstRaw);
      const first = await createHttpApp().request(
        "/v1/discord/interactions",
        { method: "POST", headers: signed.headers, body: firstRaw },
        createTestEnv({
          DISCORD_PUBLIC_KEY: signed.publicKeyHex,
          MESSAGE_WORKFLOW: ambiguousWorkflow,
        }),
      );
      expect(first.status).toBe(200);
      await expect(first.json()).resolves.toMatchObject({
        data: {
          content:
            "Reply delivery could not be confirmed. Check the thread before sending again with /reply.",
        },
      });

      const deadline = Date.now() + 2_000;
      while (translationStartedCount === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(translationStartedCount).toBe(1);

      const fresh = await sendSignedCommand({
        ...commandPayload(snowflakeAt(Date.now() + 1_000, 95n), "reply", [
          { name: "message", value: "Delayed translation reply." },
          { name: "translate", value: "my-MM" },
        ]),
        token: "fresh-while-inflight-token",
      });
      expect(fresh.status).toBe(200);
      const freshBody = (await fresh.json()) as { data: { content: string } };
      expect(freshBody.data.content).toBe(
        "This reply is already in progress. Check the thread before sending again.",
      );
      expect(freshBody.data.content).not.toMatch(/\/(status|retry|agent|approve)\b/i);
      expect(await workflows.get()).toHaveLength(1);

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("complete");

      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: outgoingTranslation.translatedText,
          state: "available",
        }),
      ]);
      expect(
        await env.DB.prepare(
          "SELECT count(*) n FROM message WHERE thread_id = ? AND direction = 'operator_to_customer'",
        )
          .bind(customer.threadId)
          .first("n"),
      ).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("returns the unconfirmed private review preview on a fresh /reply with the same text without starting a second workflow", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async () => Response.json({})),
    );

    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult(
          { name: "translate-message" },
          { ...outgoingTranslation, needsReview: true },
        );
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000105" },
        );
      });

      const firstInteractionId = snowflakeAt(Date.now(), 96n);
      const first = await sendSignedCommand({
        ...commandPayload(firstInteractionId, "reply", [
          { name: "message", value: "Reviewable reply text." },
          { name: "translate", value: "my-MM" },
        ]),
        token: "review-first-token",
      });
      expect(first.status).toBe(200);
      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStepResult({ name: "notify-reply-review-1" });

      const fresh = await sendSignedCommand({
        ...commandPayload(snowflakeAt(Date.now() + 1_000, 97n), "reply", [
          { name: "message", value: "Reviewable reply text." },
          { name: "translate", value: "my-MM" },
        ]),
        token: "review-second-token",
      });
      expect(fresh.status).toBe(200);
      await expect(fresh.json()).resolves.toMatchObject({
        data: {
          content: expect.stringContaining("Review required · reply not sent"),
          components: [
            {
              type: 1,
              components: [
                expect.objectContaining({
                  label: "Send this translation",
                  custom_id: `confirm-translation:${firstInteractionId}:1`,
                }),
              ],
            },
          ],
        },
      });
      expect(await workflows.get()).toHaveLength(1);

      const confirmCtx = createExecutionContext();
      const confirmRes = await sendSignedCommand(
        {
          ...commandPayload(snowflakeAt(Date.now() + 2_000, 98n), "reply", []),
          type: 3,
          token: "review-confirm-token",
          data: { custom_id: `confirm-translation:${firstInteractionId}:1`, component_type: 2 },
        },
        confirmCtx,
      );
      expect(confirmRes.status).toBe(200);
      await instance.waitForStatus("complete");
      await waitOnExecutionContext(confirmCtx);

      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: outgoingTranslation.translatedText,
          state: "available",
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("allows sending the same text again after a delivered /reply so the customer gets two messages", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async () => Response.json({})),
    );

    const firstWorkflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await firstWorkflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000106" },
        );
      });
      const first = await sendSignedCommand(
        commandPayload(snowflakeAt(Date.now(), 99n), "reply", [
          { name: "message", value: "Please restart the app." },
        ]),
      );
      expect(first.status).toBe(200);
      await (await oneCapturedWorkflow(firstWorkflows)).waitForStatus("complete");
      expect((await pollMessages(customer)).messages).toHaveLength(1);
    } finally {
      await firstWorkflows.dispose();
    }

    const secondWorkflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await secondWorkflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000107" },
        );
      });
      const second = await sendSignedCommand(
        commandPayload(snowflakeAt(Date.now() + 1_000, 100n), "reply", [
          { name: "message", value: "Please restart the app." },
        ]),
      );
      expect(second.status).toBe(200);
      await expect(second.json()).resolves.toMatchObject({
        data: { content: "Queued for delivery as written." },
      });
      await (await oneCapturedWorkflow(secondWorkflows)).waitForStatus("complete");
      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: "Please restart the app.",
          state: "available",
        }),
        expect.objectContaining({
          direction: "operator_to_customer",
          text: "Please restart the app.",
          state: "available",
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
      await secondWorkflows.dispose();
    }
  });

  it("does not block a fresh /reply when a prior processing receipt has a terminal errored workflow", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async () => Response.json({})),
    );

    const staleInteractionId = snowflakeAt(Date.now(), 101n);
    const staleWorkflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await staleWorkflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepError(
          { name: "publish-original-reply" },
          new Error("Transient publish error"),
        );
        await modifier.mockStepError(
          { name: "record-terminal-failure" },
          new Error("Failure recording interrupted"),
        );
      });
      const first = await sendSignedCommand(
        commandPayload(staleInteractionId, "reply", [
          { name: "message", value: "Recover after stale errored workflow." },
        ]),
      );
      expect(first.status).toBe(200);
      await (await oneCapturedWorkflow(staleWorkflows)).waitForStatus("errored");
      expect(
        await env.DB.prepare(
          "SELECT m.processing_status, m.customer_availability FROM message m JOIN discord_interaction i ON i.message_id = m.id WHERE i.interaction_id = ?",
        )
          .bind(staleInteractionId)
          .first(),
      ).toEqual({
        processing_status: "processing",
        customer_availability: "pending",
      });
    } finally {
      await staleWorkflows.dispose();
    }

    const freshWorkflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await freshWorkflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000108" },
        );
      });
      const fresh = await sendSignedCommand(
        commandPayload(snowflakeAt(Date.now() + 1_000, 102n), "reply", [
          { name: "message", value: "Recover after stale errored workflow." },
        ]),
      );
      expect(fresh.status).toBe(200);
      await expect(fresh.json()).resolves.toMatchObject({
        data: { content: "Queued for delivery as written." },
      });
      await (await oneCapturedWorkflow(freshWorkflows)).waitForStatus("complete");
      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: "Recover after stale errored workflow.",
          state: "available",
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
      await freshWorkflows.dispose();
    }
  });

  it("tells the operator not to resend when an earlier ambiguous /reply is already customer-available while Discord audit is still delayed", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    let auditStarted = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (request, init) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.href
              : request.url;
        if (init?.method === "GET" && url.endsWith("/messages?limit=100")) {
          return Response.json([]);
        }
        if (
          init?.method === "POST" &&
          url.includes("/channels/") &&
          url.endsWith("/messages") &&
          typeof init.body === "string"
        ) {
          auditStarted += 1;
          await new Promise((resolve) => setTimeout(resolve, 600));
          const body = JSON.parse(init.body) as { content: string; nonce: string };
          return Response.json({
            id: "100000000000000109",
            channel_id: TEST_TOPOLOGY.discordThreadId,
            content: body.content,
            nonce: body.nonce,
          });
        }
        if (init?.method === "PATCH" && url.includes("/webhooks/")) {
          return Response.json({});
        }
        return Response.json([]);
      }),
    );

    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
      });

      const ambiguousWorkflow = {
        createBatch: vi.fn(async (items: WorkflowInstanceCreateOptions<unknown>[]) => {
          await env.MESSAGE_WORKFLOW.createBatch(
            items as Parameters<ApiEnv["MESSAGE_WORKFLOW"]["createBatch"]>[0],
          );
          throw new Error("Lost response after workflow started");
        }),
        get: vi.fn(async () => {
          throw new Error("Status lookup unavailable during ambiguity");
        }),
      } as unknown as ApiEnv["MESSAGE_WORKFLOW"];

      const firstRaw = JSON.stringify({
        ...commandPayload(snowflakeAt(Date.now(), 104n), "reply", [
          { name: "message", value: "Already published while audit posts." },
        ]),
        token: "audit-delayed-first-token",
      });
      const signed = await signedRequest(firstRaw);
      const first = await createHttpApp().request(
        "/v1/discord/interactions",
        { method: "POST", headers: signed.headers, body: firstRaw },
        createTestEnv({
          DISCORD_PUBLIC_KEY: signed.publicKeyHex,
          MESSAGE_WORKFLOW: ambiguousWorkflow,
        }),
      );
      expect(first.status).toBe(200);

      const deadline = Date.now() + 2_000;
      while (auditStarted === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(auditStarted).toBe(1);
      expect(
        await env.DB.prepare(
          "SELECT processing_status, customer_availability FROM message WHERE thread_id = ? AND direction = 'operator_to_customer'",
        )
          .bind(customer.threadId)
          .first(),
      ).toEqual({
        processing_status: "processing",
        customer_availability: "available",
      });

      const fresh = await sendSignedCommand({
        ...commandPayload(snowflakeAt(Date.now() + 1_000, 105n), "reply", [
          { name: "message", value: "Already published while audit posts." },
        ]),
        token: "audit-delayed-second-token",
      });
      expect(fresh.status).toBe(200);
      await expect(fresh.json()).resolves.toMatchObject({
        data: {
          content: "Already sent to the customer. The thread copy is still posting. Do not resend.",
        },
      });
      expect(await workflows.get()).toHaveLength(1);

      await (await oneCapturedWorkflow(workflows)).waitForStatus("complete");
      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: "Already published while audit posts.",
          state: "available",
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("never falls through to a second send when an unfinished row is already customer-available even if its workflow ended or errored", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const db = createDatabase(env.DB);
    const workspaceId = WorkspaceIdSchema.parse(TEST_TOPOLOGY.workspaceId);
    const inboxId = InboxIdSchema.parse(TEST_TOPOLOGY.inboxId);
    const originalInteractionId = snowflakeAt(Date.now() - 5_000, 106n);
    const originalIdentity = await deriveOperatorMessageIdentity({
      applicationId: TEST_TOPOLOGY.applicationId,
      interactionId: originalInteractionId,
    });
    await acceptReplyIngress(db, {
      integrationId: TEST_TOPOLOGY.integrationId,
      interactionId: originalInteractionId,
      workspaceId,
      inboxId,
      threadId: customer.threadId,
      ...originalIdentity,
      applicationId: TEST_TOPOLOGY.applicationId,
      guildId: TEST_TOPOLOGY.guildId,
      discordThreadId: TEST_TOPOLOGY.discordThreadId,
      operatorUserId: TEST_TOPOLOGY.operatorId,
      operatorRoleIds: [TEST_TOPOLOGY.operatorRoleId],
      acceptedAt: new Date(Date.now() - 5_000),
      originalEnglishText: "Already delivered with ended workflow.",
      replyTranslation: "off",
      replyTranslationRequest: "off",
    });
    await env.DB.prepare(
      "UPDATE message SET processing_status = 'processing', customer_availability = 'available', customer_visible_text = original_text WHERE id = ?",
    )
      .bind(originalIdentity.messageId)
      .run();

    for (const terminalStatus of ["complete", "errored"] as const) {
      const createBatch = vi.fn(async () => [] as WorkflowInstance[]);
      const endedWorkflow = {
        createBatch,
        get: vi.fn(async () => ({
          status: vi.fn(async () => ({ status: terminalStatus })),
        })),
      } as unknown as ApiEnv["MESSAGE_WORKFLOW"];
      const rawBody = JSON.stringify(
        commandPayload(
          snowflakeAt(Date.now() + (terminalStatus === "complete" ? 1_000 : 2_000), 107n),
          "reply",
          [{ name: "message", value: "Already delivered with ended workflow." }],
        ),
      );
      const signed = await signedRequest(rawBody);
      const response = await createHttpApp().request(
        "/v1/discord/interactions",
        { method: "POST", headers: signed.headers, body: rawBody },
        createTestEnv({
          DISCORD_PUBLIC_KEY: signed.publicKeyHex,
          MESSAGE_WORKFLOW: endedWorkflow,
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: {
          content: "Already sent to the customer. The thread copy is still posting. Do not resend.",
        },
      });
      expect(createBatch).not.toHaveBeenCalled();
    }
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM message WHERE thread_id = ? AND direction = 'operator_to_customer'",
      )
        .bind(customer.threadId)
        .first("n"),
    ).toBe(1);
  });

  it("sends a fresh plain reply instead of showing a pending translate:my review button when the operator switches to translate:off", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async () => Response.json({})),
    );

    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult(
          { name: "translate-message" },
          { ...outgoingTranslation, targetLanguage: "my", needsReview: true },
        );
        await modifier.mockStepResult(
          { name: "post-available-audit-0" },
          { discordMessageId: "100000000000000110" },
        );
      });

      const translatedInteractionId = snowflakeAt(Date.now(), 108n);
      const first = await sendSignedCommand({
        ...commandPayload(translatedInteractionId, "reply", [
          { name: "message", value: "Please check your settings." },
          { name: "translate", value: "my" },
        ]),
        token: "review-my-token",
      });
      expect(first.status).toBe(200);
      const firstInstance = await oneCapturedWorkflow(workflows);
      await firstInstance.waitForStepResult({ name: "notify-reply-review-1" });

      // Same text with translate:my recovers the existing preview button without a second workflow.
      const sameOption = await sendSignedCommand({
        ...commandPayload(snowflakeAt(Date.now() + 1_000, 109n), "reply", [
          { name: "message", value: "Please check your settings." },
          { name: "translate", value: "my" },
        ]),
        token: "review-my-again-token",
      });
      expect(sameOption.status).toBe(200);
      await expect(sameOption.json()).resolves.toMatchObject({
        data: {
          content: expect.stringContaining("Review required · reply not sent"),
          components: [
            {
              type: 1,
              components: [
                expect.objectContaining({
                  label: "Send this translation",
                  custom_id: `confirm-translation:${translatedInteractionId}:1`,
                }),
              ],
            },
          ],
        },
      });
      expect(await workflows.get()).toHaveLength(1);

      // Same text with translate:off must NOT show the translate:my button; it sends a fresh plain reply.
      const plainReply = await sendSignedCommand({
        ...commandPayload(snowflakeAt(Date.now() + 2_000, 110n), "reply", [
          { name: "message", value: "Please check your settings." },
        ]),
        token: "plain-reply-token",
      });
      expect(plainReply.status).toBe(200);
      const plainBody = (await plainReply.json()) as {
        data: { content: string; components?: unknown[] };
      };
      expect(plainBody.data.content).toBe("Queued for delivery as written.");
      expect(plainBody.data.components).toBeUndefined();

      const allInstances = await workflows.get();
      expect(allInstances).toHaveLength(2);
      const plainInstance = allInstances[1];
      if (!plainInstance) throw new Error("Expected fresh plain reply workflow");
      await plainInstance.waitForStatus("complete");

      expect((await pollMessages(customer)).messages).toEqual([
        expect.objectContaining({
          direction: "operator_to_customer",
          text: "Please check your settings.",
          state: "available",
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
      await workflows.dispose();
    }
  });

  it("bounds review preview retries with constant 5s delay, limit 3, 15s timeout, and 13-minute deadline so terminal notices fit inside 900s", async () => {
    expect(PRIVATE_PREVIEW_STEP).toEqual({
      retries: { limit: 3, delay: "5 seconds", backoff: "constant" },
      timeout: "15 seconds",
    });
    expect(PRIVATE_PREVIEW_RETRY_DELAY_MS).toBe(5_000);
    expect(DISCORD_PREVIEW_DEADLINE_MS).toBe(13 * 60 * 1_000);
    expect(DISCORD_INTERACTION_TOKEN_LIFETIME_MS - DISCORD_PREVIEW_DEADLINE_MS).toBe(
      2 * 60 * 1_000,
    );

    const acceptedAtMs = Date.parse("2026-11-22T12:00:00.000Z");
    const acceptedAtIso = new Date(acceptedAtMs).toISOString();
    expect(() =>
      assertPreviewTokenActive(acceptedAtIso, acceptedAtMs + DISCORD_PREVIEW_DEADLINE_MS - 1),
    ).not.toThrow();
    expect(() =>
      assertPreviewTokenActive(acceptedAtIso, acceptedAtMs + DISCORD_PREVIEW_DEADLINE_MS),
    ).toThrow(NonRetryableError);
    expect(() =>
      assertPreviewTokenActive(
        acceptedAtIso,
        acceptedAtMs + 776_000 + PRIVATE_PREVIEW_RETRY_DELAY_MS,
      ),
    ).toThrow(NonRetryableError);

    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const thread = await env.DB.prepare("SELECT visitor_id FROM thread WHERE id = ?")
      .bind(customer.threadId)
      .first<{ visitor_id: string }>();
    if (!thread) throw new Error("Expected thread");

    // Case 1: 503 at interaction age 776s -> next attempt at 781s exceeds 780s deadline -> fails closed immediately and delivers terminal notice well before 900s.
    {
      let previewAttempts = 0;
      const failureNotices: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof globalThis.fetch>(async (request, init) => {
          const url =
            typeof request === "string"
              ? request
              : request instanceof URL
                ? request.href
                : request.url;
          if (
            init?.method === "PATCH" &&
            url.includes("/age-776s-token/") &&
            typeof init.body === "string"
          ) {
            const content = (JSON.parse(init.body) as { content: string }).content;
            if (content.includes("Review required")) {
              previewAttempts += 1;
              return new Response("Discord unavailable", { status: 503 });
            }
            failureNotices.push(content);
            return Response.json({});
          }
          return Response.json([]);
        }),
      );

      const agedAtMs = Date.now() - 776_000;
      const interactionId = snowflakeAt(agedAtMs, 111n);
      const identity = await deriveOperatorMessageIdentity({
        applicationId: TEST_TOPOLOGY.applicationId,
        interactionId,
      });
      const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
      try {
        await workflows.modifyAll(async (modifier) => {
          await modifier.disableRetryDelays();
          await modifier.mockStepResult(
            { name: "translate-message" },
            { ...outgoingTranslation, needsReview: true },
          );
        });
        await env.MESSAGE_WORKFLOW.create({
          id: identity.workflowInstanceId,
          params: {
            schema: "respondkit.workflow-message/1",
            direction: "operator_to_customer",
            workspaceId: WorkspaceIdSchema.parse(TEST_TOPOLOGY.workspaceId),
            inboxId: InboxIdSchema.parse(TEST_TOPOLOGY.inboxId),
            threadId: customer.threadId,
            visitorId: thread.visitor_id,
            ...identity,
            originalText: "Near-deadline 503 preview.",
            acceptedAt: new Date(agedAtMs).toISOString(),
            replyTranslation: "my-MM",
            replyTranslationRequest: "my-MM",
            discord: {
              integrationId: TEST_TOPOLOGY.integrationId,
              interactionId,
              interactionToken: "age-776s-token",
              applicationId: TEST_TOPOLOGY.applicationId,
              guildId: TEST_TOPOLOGY.guildId,
              threadId: TEST_TOPOLOGY.discordThreadId,
              operatorId: TEST_TOPOLOGY.operatorId,
              operatorRoleIds: [TEST_TOPOLOGY.operatorRoleId],
            },
          },
        });
        const instance = await oneCapturedWorkflow(workflows);
        await instance.waitForStatus("errored");
        await expect(instance.getError()).resolves.toMatchObject({
          message: expect.stringContaining("NonRetryableError"),
        });
        expect(previewAttempts).toBe(1);
        expect(failureNotices).toEqual(["Reply not sent. Send it again with /reply."]);
        expect(Date.now() - agedAtMs).toBeLessThan(DISCORD_INTERACTION_TOKEN_LIFETIME_MS);
        expect((await pollMessages(customer)).messages).toEqual([]);
        expect(
          await env.DB.prepare(
            "SELECT processing_status, customer_availability FROM message WHERE id = ?",
          )
            .bind(identity.messageId)
            .first(),
        ).toEqual({
          processing_status: "failed",
          customer_availability: "not_available",
        });
      } finally {
        vi.unstubAllGlobals();
        await workflows.dispose();
      }
    }

    // Case 2: At interaction age 780s -> zero preview attempts start, terminal notice fires well before 900s.
    {
      let previewAttempts = 0;
      const failureNotices: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof globalThis.fetch>(async (request, init) => {
          const url =
            typeof request === "string"
              ? request
              : request instanceof URL
                ? request.href
                : request.url;
          if (
            init?.method === "PATCH" &&
            url.includes("/age-780s-token/") &&
            typeof init.body === "string"
          ) {
            const content = (JSON.parse(init.body) as { content: string }).content;
            if (content.includes("Review required")) {
              previewAttempts += 1;
              return new Response("Discord unavailable", { status: 503 });
            }
            failureNotices.push(content);
            return Response.json({});
          }
          return Response.json([]);
        }),
      );

      const expiredAtMs = Date.now() - DISCORD_PREVIEW_DEADLINE_MS;
      const interactionId = snowflakeAt(expiredAtMs, 112n);
      const identity = await deriveOperatorMessageIdentity({
        applicationId: TEST_TOPOLOGY.applicationId,
        interactionId,
      });
      const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
      try {
        await workflows.modifyAll(async (modifier) => {
          await modifier.disableRetryDelays();
          await modifier.mockStepResult(
            { name: "translate-message" },
            { ...outgoingTranslation, needsReview: true },
          );
        });
        await env.MESSAGE_WORKFLOW.create({
          id: identity.workflowInstanceId,
          params: {
            schema: "respondkit.workflow-message/1",
            direction: "operator_to_customer",
            workspaceId: WorkspaceIdSchema.parse(TEST_TOPOLOGY.workspaceId),
            inboxId: InboxIdSchema.parse(TEST_TOPOLOGY.inboxId),
            threadId: customer.threadId,
            visitorId: thread.visitor_id,
            ...identity,
            originalText: "Past-deadline preview.",
            acceptedAt: new Date(expiredAtMs).toISOString(),
            replyTranslation: "my-MM",
            replyTranslationRequest: "my-MM",
            discord: {
              integrationId: TEST_TOPOLOGY.integrationId,
              interactionId,
              interactionToken: "age-780s-token",
              applicationId: TEST_TOPOLOGY.applicationId,
              guildId: TEST_TOPOLOGY.guildId,
              threadId: TEST_TOPOLOGY.discordThreadId,
              operatorId: TEST_TOPOLOGY.operatorId,
              operatorRoleIds: [TEST_TOPOLOGY.operatorRoleId],
            },
          },
        });
        const instance = await oneCapturedWorkflow(workflows);
        await instance.waitForStatus("errored");
        await expect(instance.getError()).resolves.toMatchObject({
          message: expect.stringContaining("NonRetryableError"),
        });
        expect(previewAttempts).toBe(0);
        expect(failureNotices).toEqual(["Reply not sent. Send it again with /reply."]);
        expect(Date.now() - expiredAtMs).toBeLessThan(DISCORD_INTERACTION_TOKEN_LIFETIME_MS);
        expect((await pollMessages(customer)).messages).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
        await workflows.dispose();
      }
    }
  });
});
