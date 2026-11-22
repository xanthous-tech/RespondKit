import {
  applyD1Migrations,
  env,
  introspectWorkflow,
  reset,
  type D1Migration,
} from "cloudflare:test";
import { expect, it, vi } from "vite-plus/test";
import {
  createCustomerFixture,
  createTestEnv,
  seedReadyDiscordThread,
  seedTopology,
  TEST_TOPOLOGY,
} from "../test/fixtures";
import { agentTokenHash } from "./agent-api";
import { createHttpApp } from "./http";

declare const __D1_MIGRATIONS__: D1Migration[];

it("upgrades existing 0008 data through 0012 preserving transcripts and dropping removed agent tables", async () => {
  await reset();
  await applyD1Migrations(
    env.DB,
    __D1_MIGRATIONS__.filter((migration) => migration.name < "0009"),
  );
  await seedTopology();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO visitor(id,workspace_id,inbox_id,installation_id) VALUES ('legacy-visitor',?,?, 'legacy')",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId),
    env.DB.prepare(
      "INSERT INTO thread(id,workspace_id,inbox_id,visitor_id,client_thread_id) VALUES ('legacy-thread',?,?, 'legacy-visitor','legacy')",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId),
    env.DB.prepare(
      "INSERT INTO message(id,workspace_id,inbox_id,thread_id,workflow_instance_id,direction,original_text,accepted_at) VALUES ('legacy-message',?,?,'legacy-thread','legacy-workflow','operator_to_customer','Existing reply',1000)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO message(id,workspace_id,inbox_id,thread_id,workflow_instance_id,direction,original_text,customer_visible_text,client_message_id,accepted_at) VALUES ('legacy-customer',?,?,'legacy-thread','legacy-customer-workflow','customer_to_operator','Existing question','Existing question','legacy-client',500)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId),
    env.DB.prepare(
      "INSERT INTO message(id,workspace_id,inbox_id,thread_id,workflow_instance_id,direction,original_text,accepted_at) VALUES ('legacy-email',?,?,'legacy-thread','legacy-email-workflow','operator_to_customer','Email answer',1500)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId),
    env.DB.prepare("INSERT INTO email_ingress VALUES ('legacy-email',?)").bind(
      JSON.stringify({ source: "email", email: { sender: "operator@example.test" } }),
    ),
  ]);
  await applyD1Migrations(env.DB, __D1_MIGRATIONS__);
  expect(
    await env.DB.prepare(
      "SELECT original_text,author_kind,author_name FROM message WHERE id='legacy-message'",
    ).first(),
  ).toEqual({ original_text: "Existing reply", author_kind: "operator", author_name: null });
  expect(
    await env.DB.prepare(
      "SELECT original_text,author_kind,author_name FROM message WHERE id='legacy-email'",
    ).first(),
  ).toEqual({
    original_text: "Email answer",
    author_kind: "email",
    author_name: "operator@example.test",
  });
  expect(
    await env.DB.prepare(
      "SELECT original_text,author_kind FROM message WHERE id='legacy-customer'",
    ).first(),
  ).toEqual({ original_text: "Existing question", author_kind: null });
  expect(await env.DB.prepare("SELECT count(*) n FROM agent_reply").first("n")).toBe(0);
  expect(await env.DB.prepare("SELECT count(*) n FROM agent_rate_limit").first("n")).toBe(0);
});

it("upgrades populated 0011 to 0012: drops removed tables/columns, bumps message sequence past timeline, and preserves send idempotency", async () => {
  await reset();
  await applyD1Migrations(
    env.DB,
    __D1_MIGRATIONS__.filter((migration) => migration.name < "0012"),
  );
  await seedTopology();
  const customer = await createCustomerFixture();
  await seedReadyDiscordThread(customer.threadId);
  const threadRow = await env.DB.prepare("SELECT visitor_id FROM thread WHERE id=?")
    .bind(customer.threadId)
    .first<{ visitor_id: string }>();

  const idempotencyKey = "pre-deploy-send-key";
  const identity = await agentTokenHash(JSON.stringify([TEST_TOPOLOGY.inboxId, idempotencyKey]));
  const sentMessageId = `msg_agent_${identity}`;
  const sentWorkflowId = `agent_${identity}`;
  const sentAcceptedAt = "2026-11-20T10:00:00.000Z";
  const preDeployRequest = {
    threadId: customer.threadId,
    text: "Pre-deploy answer",
    idempotencyKey,
    translate: "off",
    mode: "send",
  };
  const preDeployEnvelope = {
    schema: "respondkit.workflow-message/1",
    source: "agent",
    direction: "operator_to_customer",
    workspaceId: TEST_TOPOLOGY.workspaceId,
    inboxId: TEST_TOPOLOGY.inboxId,
    threadId: customer.threadId,
    visitorId: threadRow!.visitor_id,
    messageId: sentMessageId,
    workflowInstanceId: sentWorkflowId,
    acceptedAt: sentAcceptedAt,
    originalText: "Pre-deploy answer",
    replyTranslation: "off",
    replyTranslationRequest: "off",
    agent: { name: "Helper", mode: "send" },
  };

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE thread SET claimed_by='old-runner', claim_expires_at=9999999999999 WHERE id=?",
    ).bind(customer.threadId),
    env.DB.prepare(
      "INSERT INTO message(id,workspace_id,inbox_id,thread_id,workflow_instance_id,direction,original_text,customer_visible_text,client_message_id,accepted_at) VALUES ('cust-1',?,?,?,'wf-cust-1','customer_to_operator','Need help','Need help','client-1',1000)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId),
    env.DB.prepare(
      "INSERT INTO agent_reply(message_id,workspace_id,inbox_id,thread_id,idempotency_key,request_json,envelope,mode,status,basis_row_id,created_at) VALUES (?,?,?,?,?,?,?,'send','approved',1,1500)",
    ).bind(
      sentMessageId,
      TEST_TOPOLOGY.workspaceId,
      TEST_TOPOLOGY.inboxId,
      customer.threadId,
      idempotencyKey,
      JSON.stringify(preDeployRequest),
      JSON.stringify(preDeployEnvelope),
    ),
    env.DB.prepare(
      "INSERT INTO message(id,workspace_id,inbox_id,thread_id,workflow_instance_id,direction,author_kind,author_name,original_text,customer_visible_text,reply_translation,reply_translation_request,processing_status,customer_availability,accepted_at) VALUES (?,?,?,?,?,'operator_to_customer','agent','Helper','Pre-deploy answer','Pre-deploy answer','off','off','succeeded','available',1500)",
    ).bind(
      sentMessageId,
      TEST_TOPOLOGY.workspaceId,
      TEST_TOPOLOGY.inboxId,
      customer.threadId,
      sentWorkflowId,
    ),
    env.DB.prepare(
      "INSERT INTO agent_reply(message_id,workspace_id,inbox_id,thread_id,idempotency_key,request_json,envelope,mode,status,basis_row_id,created_at) VALUES ('pending-draft',?,?,?,'pending-key','{}','{}','draft','pending',2,1600)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId),
    env.DB.prepare(
      "INSERT INTO agent_reply(message_id,workspace_id,inbox_id,thread_id,idempotency_key,request_json,envelope,mode,status,basis_row_id,created_at) VALUES ('rejected-draft',?,?,?,'rejected-key','{}','{}','draft','rejected',2,1700)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId),
    env.DB.prepare(
      "INSERT INTO agent_draft_chunk VALUES ('900000000000000001',?,'pending-draft',0)",
    ).bind(TEST_TOPOLOGY.discordThreadId),
    env.DB.prepare(
      "INSERT INTO agent_draft_preview(message_id,result_json) VALUES ('pending-draft','{}')",
    ),
    env.DB.prepare(
      "INSERT INTO internal_note(id,workspace_id,inbox_id,thread_id,author_kind,author_name,kind,text,request_json,created_at) VALUES ('note-1',?,?,?,'agent','Helper','reasoning','Old note 1','{}',1800)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId),
    env.DB.prepare(
      "INSERT INTO internal_note(id,workspace_id,inbox_id,thread_id,author_kind,author_name,kind,text,request_json,created_at) VALUES ('note-2',?,?,?,'operator','Simon','steer','Old note 2','{}',1900)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId),
    env.DB.prepare(
      "INSERT INTO internal_note(id,workspace_id,inbox_id,thread_id,author_kind,author_name,kind,text,request_json,created_at) VALUES ('note-3',?,?,?,'agent','Helper','summary','Old note 3','{}',2000)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId),
    env.DB.prepare("INSERT INTO agent_ack VALUES (?,5)").bind(customer.threadId),
    env.DB.prepare("INSERT INTO agent_rate_limit VALUES ('existing-hash',123,7)"),
  ]);

  const maxTimelineBefore = await env.DB.prepare(
    "SELECT max(sequence) AS max_seq FROM agent_timeline",
  ).first<{ max_seq: number }>();
  expect(maxTimelineBefore?.max_seq).toBe(5);

  await applyD1Migrations(env.DB, __D1_MIGRATIONS__);

  const remainingTables = (
    await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{
      name: string;
    }>()
  ).results.map((r) => r.name);
  for (const dropped of [
    "internal_note",
    "agent_timeline",
    "agent_ack",
    "agent_draft_chunk",
    "agent_draft_preview",
  ]) {
    expect(remainingTables).not.toContain(dropped);
  }
  const remainingTriggers = (
    await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name").all<{
      name: string;
    }>()
  ).results.map((r) => r.name);
  expect(remainingTriggers).toEqual(["cancel_read_emails", "queue_operator_email"]);

  const threadCols = (
    await env.DB.prepare("PRAGMA table_info(thread)").all<{ name: string }>()
  ).results.map((c) => c.name);
  expect(threadCols).not.toContain("claimed_by");
  expect(threadCols).not.toContain("claim_expires_at");

  const replyCols = (
    await env.DB.prepare("PRAGMA table_info(agent_reply)").all<{ name: string }>()
  ).results.map((c) => c.name);
  expect(replyCols).toEqual([
    "message_id",
    "workspace_id",
    "inbox_id",
    "thread_id",
    "idempotency_key",
    "request_json",
    "envelope",
    "created_at",
  ]);

  // Only the pre-deploy sent row survived; pending/rejected drafts were dropped.
  const carried = await env.DB.prepare(
    "SELECT message_id, request_json, envelope FROM agent_reply",
  ).all<{ message_id: string; request_json: string; envelope: string }>();
  expect(carried.results).toHaveLength(1);
  expect(carried.results[0]?.message_id).toBe(sentMessageId);
  expect(JSON.parse(carried.results[0]!.envelope).agent).toEqual({ name: "Helper" });
  expect(await env.DB.prepare("SELECT count(*) n FROM agent_rate_limit").first("n")).toBe(1);

  // Cursor monotonicity: a post-migration message gets row_id > pre-migration max(agent_timeline.sequence).
  await env.DB.prepare(
    "INSERT INTO message(id,workspace_id,inbox_id,thread_id,workflow_instance_id,direction,original_text,customer_visible_text,client_message_id,accepted_at) VALUES ('cust-post',?,?,?,'wf-cust-post','customer_to_operator','Follow up','Follow up','client-post',3000)",
  )
    .bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId)
    .run();
  const postRowId = await env.DB.prepare("SELECT row_id FROM message WHERE id='cust-post'").first<{
    row_id: number;
  }>();
  expect(postRowId!.row_id).toBeGreaterThan(maxTimelineBefore!.max_seq);

  // Pre-deploy send retried post-deploy with the same idempotencyKey (with or without mode:'send') delivers once.
  const token = "migration-test-agent-token";
  const apiEnv = createTestEnv({
    [`AGENT_TOKEN_${TEST_TOPOLOGY.inboxId}`]: await agentTokenHash(token),
    [`AGENT_NAME_${TEST_TOPOLOGY.inboxId}`]: "Helper",
  });
  const app = createHttpApp();
  const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
  try {
    await workflows.modifyAll(async (modifier) => modifier.disableRetryDelays());
    for (const payload of [
      { text: "Pre-deploy answer", idempotencyKey, translate: "off", mode: "send" },
      { text: "Pre-deploy answer", idempotencyKey, translate: "off" },
    ]) {
      const retry = await app.request(
        `/v1/agent/threads/${customer.threadId}/replies`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        },
        apiEnv,
      );
      expect(retry.status).toBe(202);
      const body = await retry.json<{ messageId: string; status: string }>();
      expect(body.messageId).toBe(sentMessageId);
      expect(body.status).toBe("available");
      expect(body).not.toHaveProperty("mode");
    }
    const instances = await workflows.get();
    for (const instance of instances) await instance.waitForStatus("complete");
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM message WHERE thread_id=? AND author_kind='agent'",
      )
        .bind(customer.threadId)
        .first("n"),
    ).toBe(1);
    const conflict = await app.request(
      `/v1/agent/threads/${customer.threadId}/replies`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "Different text", idempotencyKey, translate: "off" }),
      },
      apiEnv,
    );
    expect(conflict.status).toBe(409);
  } finally {
    vi.unstubAllGlobals();
    await workflows.dispose();
  }
});
