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
  type WorkflowIntrospector,
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createDatabase } from "./db";
import type { Env as ApiEnv } from "./env";
import { createHttpApp } from "./http";
import { deriveOperatorMessageIdentity, translationRecordId } from "./identity";
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
  it("persists, translates, projects, and exposes a customer message without live APIs", async () => {
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
        operator_visible_text: incomingTranslation.translatedText,
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

  it("records a terminal translation failure and keeps the original pollable", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepError(
          { name: "translate-message" },
          new Error("Gemini is temporarily unavailable"),
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
        message: "Gemini is temporarily unavailable",
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
        failure_stage: "translation",
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

  it("projects the first persisted translation when a recreated Workflow proposes a new one", async () => {
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
      expect(await instance.waitForStepResult({ name: "store-translation" })).toEqual({
        sourceLanguage: canonical.sourceLanguage,
        targetLanguage: canonical.targetLanguage,
        translatedText: canonical.translatedText,
        mixedLanguage: canonical.mixedLanguage,
        needsReview: canonical.needsReview,
      });
      expect(postedBodies).toEqual([
        expect.objectContaining({
          content: expect.stringContaining(canonical.translatedText),
        }),
      ]);
      expect(JSON.stringify(postedBodies)).not.toContain(laterCandidate.translatedText);
      expect(JSON.stringify(postedBodies)).toContain("Translation needs review");
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
    command: "reply" | "retry" | "status",
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

  it("translates an authorized /reply and publishes it to the customer transcript", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
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
        ]),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        type: 4,
        data: {
          content: "Queued for translation and delivery.",
          flags: 64,
          allowed_mentions: { parse: [] },
        },
      });

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("complete");
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
        ]),
      );
      expect(replay.status).toBe(200);
      await expect(replay.json()).resolves.toMatchObject({
        data: { content: "Already available in chat." },
      });

      const statusResponse = await sendSignedCommand(
        commandPayload(snowflakeAt(Date.now(), 12n), "status", [
          { name: "reference", value: interactionId },
        ]),
      );
      expect(statusResponse.status).toBe(200);
      await expect(statusResponse.json()).resolves.toMatchObject({
        data: { content: "Already available in chat." },
      });

      const retryResponse = await sendSignedCommand(
        commandPayload(snowflakeAt(Date.now(), 13n), "retry", [
          { name: "reference", value: interactionId },
          { name: "message", value: "Please reopen the app." },
        ]),
      );
      expect(retryResponse.status).toBe(200);
      await expect(retryResponse.json()).resolves.toMatchObject({
        data: { content: "Already available in chat." },
      });

      const recoveryReceipts = await env.DB.prepare(
        "select command_name from discord_interaction where reference_interaction_id = ? order by command_name",
      )
        .bind(interactionId)
        .all<{ command_name: string }>();
      expect(recoveryReceipts.results).toEqual([
        { command_name: "retry" },
        { command_name: "status" },
      ]);
    } finally {
      await workflows.dispose();
    }
  });

  it("fails an operator reply closed when translation never succeeds", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepError(
          { name: "translate-message" },
          new Error("Translation provider unavailable"),
        );
        await modifier.mockStepResult(
          { name: "post-failure-audit-0" },
          { discordMessageId: "100000000000000096" },
        );
      });

      const interactionId = snowflakeAt(Date.now(), 31n);
      const response = await sendSignedCommand(
        commandPayload(interactionId, "reply", [
          { name: "message", value: "This must not leak to the customer in English." },
        ]),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: { content: "Queued for translation and delivery." },
      });

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("errored");
      expect((await pollMessages(customer)).messages).toEqual([]);

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
      await workflows.dispose();
    }
  });

  it("keeps a published reply available when only its Discord audit fails", async () => {
    const customer = await createCustomerFixture();
    await seedReadyDiscordThread(customer.threadId);
    const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
    try {
      await workflows.modifyAll(async (modifier) => {
        await modifier.disableRetryDelays();
        await modifier.mockStepResult({ name: "translate-message" }, outgoingTranslation);
        await modifier.mockStepError(
          { name: "post-available-audit-0" },
          new Error("Discord audit unavailable"),
        );
        await modifier.mockStepResult(
          { name: "post-failure-audit-0" },
          { discordMessageId: "100000000000000095" },
        );
      });

      const interactionId = snowflakeAt(Date.now(), 41n);
      const response = await sendSignedCommand(
        commandPayload(interactionId, "reply", [
          { name: "message", value: "Please reopen the app." },
        ]),
      );
      expect(response.status).toBe(200);

      const instance = await oneCapturedWorkflow(workflows);
      await instance.waitForStatus("errored");
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
      await workflows.dispose();
    }
  });
});
