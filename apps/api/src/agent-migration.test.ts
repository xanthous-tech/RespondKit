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

it("upgrades populated 0011 to 0012: remaps message row_id to timeline sequence, rebuilds discord_interaction, preserves send idempotency, and avoids dropped-draft collisions", async () => {
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
    translate: "es",
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
    replyTranslation: "es",
    replyTranslationRequest: "es",
    agent: { name: "Helper", mode: "send" },
  };
  const droppedDraftKey = "dropped-draft-key";
  const v1DroppedIdentity = await agentTokenHash(
    JSON.stringify([TEST_TOPOLOGY.inboxId, droppedDraftKey]),
  );
  const v1DroppedMessageId = `msg_agent_${v1DroppedIdentity}`;

  await env.DB.batch([
    env.DB.prepare(
      "UPDATE thread SET claimed_by='old-runner', claim_expires_at=9999999999999 WHERE id=?",
    ).bind(customer.threadId),
    // seq 1: cust-1 (already handled before migration)
    env.DB.prepare(
      "INSERT INTO message(id,workspace_id,inbox_id,thread_id,workflow_instance_id,direction,original_text,customer_visible_text,client_message_id,accepted_at) VALUES ('cust-1',?,?,?,'wf-cust-1','customer_to_operator','Need help','Need help','client-1',1000)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId),
    // seq 2: note-1 interleaved BEFORE cust-2 (OF-975 handledThrough = 2)
    env.DB.prepare(
      "INSERT INTO internal_note(id,workspace_id,inbox_id,thread_id,author_kind,author_name,kind,text,request_json,created_at) VALUES ('note-1',?,?,?,'agent','Helper','reasoning','Interleaved note','{}',1200)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId),
    // seq 3: cust-2 (old row_id = 2, old agent_timeline.sequence = 3 — unread when cursor = 2!)
    env.DB.prepare(
      "INSERT INTO message(id,workspace_id,inbox_id,thread_id,workflow_instance_id,direction,original_text,customer_visible_text,client_message_id,accepted_at) VALUES ('cust-2',?,?,?,'wf-cust-2','customer_to_operator','Unread before deploy','Unread before deploy','client-2',1400)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId),
    // seq 4: pre-deploy translated agent send (status = 'approved')
    env.DB.prepare(
      "INSERT INTO agent_reply(message_id,workspace_id,inbox_id,thread_id,idempotency_key,request_json,envelope,mode,status,basis_row_id,created_at) VALUES (?,?,?,?,?,?,?,'send','approved',2,1500)",
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
      "INSERT INTO message(id,workspace_id,inbox_id,thread_id,workflow_instance_id,direction,author_kind,author_name,original_text,customer_visible_text,reply_translation,reply_translation_request,processing_status,customer_availability,accepted_at) VALUES (?,?,?,?,?,'operator_to_customer','agent','Helper','Pre-deploy answer','Respuesta previa','es','es','succeeded','available',1500)",
    ).bind(
      sentMessageId,
      TEST_TOPOLOGY.workspaceId,
      TEST_TOPOLOGY.inboxId,
      customer.threadId,
      sentWorkflowId,
    ),
    // seq 5: operator Discord /reply message
    env.DB.prepare(
      "INSERT INTO message(id,workspace_id,inbox_id,thread_id,workflow_instance_id,direction,author_kind,original_text,customer_visible_text,processing_status,customer_availability,accepted_at) VALUES ('op-reply-1',?,?,?,'wf-op-reply-1','operator_to_customer','operator','Operator reply','Operator reply','succeeded','available',1600)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId),
    // seq 6: trailing note AFTER last message
    env.DB.prepare(
      "INSERT INTO internal_note(id,workspace_id,inbox_id,thread_id,author_kind,author_name,kind,text,request_json,created_at) VALUES ('note-2',?,?,?,'operator','Simon','steer','Trailing note','{}',1900)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId),
    // Child tables referencing message(id, ...) must survive row_id remapping intact
    env.DB.prepare(
      "INSERT INTO message_translation(id,workspace_id,inbox_id,thread_id,message_id,source_language,target_language,translated_text,prompt_version,provider,model) VALUES ('tr-1',?,?,?,?,'en','es','Respuesta previa','v1','google','gemini')",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId, sentMessageId),
    env.DB.prepare(
      "INSERT INTO customer_transcript_entry(workspace_id,inbox_id,thread_id,message_id,processing_generation,event_kind,event_at) VALUES (?,?,?,'cust-1',1,'available',1000)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId),
    env.DB.prepare(
      "INSERT INTO attachment(id,workspace_id,inbox_id,visitor_id,object_key,download_token,download_url,name,content_type,size,upload_id,part_size,status,message_id) VALUES (? ,?,?,?, 'obj-1', 'tok-1', 'https://api.example/f', 'a.png', 'image/png', 10, '', 1, 'ready', 'cust-1')",
    ).bind(
      `att_${"1".repeat(64)}`,
      TEST_TOPOLOGY.workspaceId,
      TEST_TOPOLOGY.inboxId,
      threadRow!.visitor_id,
    ),
    env.DB.prepare(
      "INSERT INTO discord_message(workspace_id,inbox_id,thread_id,message_id,integration_id,projection_kind,chunk_index,nonce,correlation_marker,discord_thread_id,discord_message_id,status) VALUES (?,?,?,'cust-1',?,'customer_projection',0,'nonce-1','marker-1',?,'900000000000000010','sent')",
    ).bind(
      TEST_TOPOLOGY.workspaceId,
      TEST_TOPOLOGY.inboxId,
      customer.threadId,
      TEST_TOPOLOGY.integrationId,
      TEST_TOPOLOGY.discordThreadId,
    ),
    env.DB.prepare(
      "INSERT INTO discord_interaction(integration_id,interaction_id,workspace_id,inbox_id,thread_id,message_id,application_id,guild_id,discord_thread_id,operator_user_id,operator_role_ids,command_name,reference_interaction_id,normalized_message,accepted_at) VALUES (?,'800000000000000001',?,?,?,'op-reply-1',?,?,?,?,'[]','reply',NULL,'Operator reply',1600)",
    ).bind(
      TEST_TOPOLOGY.integrationId,
      TEST_TOPOLOGY.workspaceId,
      TEST_TOPOLOGY.inboxId,
      customer.threadId,
      TEST_TOPOLOGY.applicationId,
      TEST_TOPOLOGY.guildId,
      TEST_TOPOLOGY.discordThreadId,
      TEST_TOPOLOGY.operatorId,
    ),
    env.DB.prepare(
      "INSERT INTO discord_interaction(integration_id,interaction_id,workspace_id,inbox_id,thread_id,message_id,application_id,guild_id,discord_thread_id,operator_user_id,operator_role_ids,command_name,reference_interaction_id,normalized_message,accepted_at) VALUES (?,'800000000000000002',?,?,?,NULL,?,?,?,?,'[]','status','800000000000000001',NULL,1650)",
    ).bind(
      TEST_TOPOLOGY.integrationId,
      TEST_TOPOLOGY.workspaceId,
      TEST_TOPOLOGY.inboxId,
      customer.threadId,
      TEST_TOPOLOGY.applicationId,
      TEST_TOPOLOGY.guildId,
      TEST_TOPOLOGY.discordThreadId,
      TEST_TOPOLOGY.operatorId,
    ),
    env.DB.prepare(
      "INSERT INTO discord_interaction(integration_id,interaction_id,workspace_id,inbox_id,thread_id,message_id,application_id,guild_id,discord_thread_id,operator_user_id,operator_role_ids,command_name,reference_interaction_id,normalized_message,accepted_at) VALUES (?,'800000000000000003',?,?,?,NULL,?,?,?,?,'[]','retry','800000000000000001','Retried text',1660)",
    ).bind(
      TEST_TOPOLOGY.integrationId,
      TEST_TOPOLOGY.workspaceId,
      TEST_TOPOLOGY.inboxId,
      customer.threadId,
      TEST_TOPOLOGY.applicationId,
      TEST_TOPOLOGY.guildId,
      TEST_TOPOLOGY.discordThreadId,
      TEST_TOPOLOGY.operatorId,
    ),
    env.DB.prepare(
      "INSERT INTO reply_review(message_id,generation,result_json,confirmed_by,created_at) VALUES ('op-reply-1',1,'{}','op-1',1600)",
    ),
    env.DB.prepare(
      "INSERT INTO translation_job(id,workspace_id,inbox_id,thread_id,message_id,target_language,prompt_version,status,created_at,updated_at) VALUES ('tj-1',?,?,?,'cust-1','en','v1','succeeded',1000,1000)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId),
    // Dropped drafts
    env.DB.prepare(
      "INSERT INTO agent_reply(message_id,workspace_id,inbox_id,thread_id,idempotency_key,request_json,envelope,mode,status,basis_row_id,created_at) VALUES (?,?,?,?,?,'{}','{}','draft','pending',2,1700)",
    ).bind(
      v1DroppedMessageId,
      TEST_TOPOLOGY.workspaceId,
      TEST_TOPOLOGY.inboxId,
      customer.threadId,
      droppedDraftKey,
    ),
    env.DB.prepare(
      "INSERT INTO agent_reply(message_id,workspace_id,inbox_id,thread_id,idempotency_key,request_json,envelope,mode,status,basis_row_id,created_at) VALUES ('rejected-draft',?,?,?,'rejected-key','{}','{}','draft','rejected',2,1750)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId, customer.threadId),
    env.DB.prepare("INSERT INTO agent_draft_chunk VALUES ('900000000000000001',?,?,0)").bind(
      TEST_TOPOLOGY.discordThreadId,
      v1DroppedMessageId,
    ),
    env.DB.prepare("INSERT INTO agent_draft_preview(message_id,result_json) VALUES (?,'{}')").bind(
      v1DroppedMessageId,
    ),
    env.DB.prepare("INSERT INTO agent_ack VALUES (?,2)").bind(customer.threadId),
    env.DB.prepare("INSERT INTO agent_rate_limit VALUES ('existing-hash',123,7)"),
  ]);

  const maxTimelineBefore = await env.DB.prepare(
    "SELECT max(sequence) AS max_seq FROM agent_timeline",
  ).first<{ max_seq: number }>();
  expect(maxTimelineBefore?.max_seq).toBe(6);

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

  // discord_interaction rebuilt without reference_interaction_id; legacy status/retry rows dropped.
  const interactionCols = (
    await env.DB.prepare("PRAGMA table_info(discord_interaction)").all<{ name: string }>()
  ).results.map((c) => c.name);
  expect(interactionCols).not.toContain("reference_interaction_id");
  const interactionIndexes = (
    await env.DB.prepare("PRAGMA index_list(discord_interaction)").all<{
      name: string;
      unique: number;
    }>()
  ).results;
  expect(interactionIndexes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "discord_interaction_message_uq", unique: 1 }),
      expect.objectContaining({ name: "discord_interaction_thread_idx", unique: 0 }),
    ]),
  );
  const interactions = await env.DB.prepare(
    "SELECT interaction_id, command_name, message_id FROM discord_interaction",
  ).all<{ interaction_id: string; command_name: string; message_id: string }>();
  expect(interactions.results).toEqual([
    { interaction_id: "800000000000000001", command_name: "reply", message_id: "op-reply-1" },
  ]);

  // Only the pre-deploy sent row survived; request_json preserves non-off translate.
  const carried = await env.DB.prepare(
    "SELECT message_id, request_json, envelope FROM agent_reply",
  ).all<{ message_id: string; request_json: string; envelope: string }>();
  expect(carried.results).toHaveLength(1);
  expect(carried.results[0]?.message_id).toBe(sentMessageId);
  expect(JSON.parse(carried.results[0]!.request_json)).toEqual({
    threadId: customer.threadId,
    text: "Pre-deploy answer",
    translate: "es",
  });
  expect(JSON.parse(carried.results[0]!.envelope).agent).toEqual({ name: "Helper" });
  expect(await env.DB.prepare("SELECT count(*) n FROM agent_rate_limit").first("n")).toBe(1);

  // Act-on #1: existing message.row_id matches old agent_timeline.sequence, preserving OF-975 cursors.
  const remapped = await env.DB.prepare(
    "SELECT id, row_id FROM message WHERE thread_id=? ORDER BY row_id ASC",
  )
    .bind(customer.threadId)
    .all<{ id: string; row_id: number }>();
  expect(remapped.results).toEqual([
    { id: "cust-1", row_id: 1 },
    { id: "cust-2", row_id: 3 },
    { id: sentMessageId, row_id: 4 },
    { id: "op-reply-1", row_id: 5 },
  ]);

  // Child rows referencing message(id, ...) remain intact.
  expect(await env.DB.prepare("SELECT count(*) n FROM message_translation").first("n")).toBe(1);
  expect(await env.DB.prepare("SELECT count(*) n FROM customer_transcript_entry").first("n")).toBe(
    1,
  );
  expect(await env.DB.prepare("SELECT count(*) n FROM attachment").first("n")).toBe(1);
  expect(await env.DB.prepare("SELECT count(*) n FROM discord_message").first("n")).toBe(1);
  expect(await env.DB.prepare("SELECT count(*) n FROM reply_review").first("n")).toBe(1);
  expect(await env.DB.prepare("SELECT count(*) n FROM translation_job").first("n")).toBe(1);

  // Reading from pre-migration cursor=2 skips cust-1 (seq 1) and returns unread cust-2 (seq 3).
  const token = "migration-test-agent-token";
  const apiEnv = createTestEnv({
    [`AGENT_TOKEN_${TEST_TOPOLOGY.inboxId}`]: await agentTokenHash(token),
    [`AGENT_NAME_${TEST_TOPOLOGY.inboxId}`]: "Helper",
  });
  const app = createHttpApp();
  const fromHandledCursor = await (
    await app.request(
      `/v1/agent/threads/${customer.threadId}?cursor=2`,
      { headers: { authorization: `Bearer ${token}` } },
      apiEnv,
    )
  ).json<{ messages: Array<{ id: string; rowId: number }>; through: string }>();
  expect(fromHandledCursor.messages.map((m) => ({ id: m.id, rowId: m.rowId }))).toEqual([
    { id: "cust-2", rowId: 3 },
    { id: sentMessageId, rowId: 4 },
    { id: "op-reply-1", rowId: 5 },
  ]);
  expect(fromHandledCursor.through).toBe("5");

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

  // Pre-deploy translated send retried post-deploy with the same idempotencyKey delivers once;
  // reusing a dropped draft's idempotencyKey derives a fresh v2 workflow/message ID and delivers once.
  const workflows = await introspectWorkflow(env.MESSAGE_WORKFLOW);
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>(async (request, init) => {
      const url =
        typeof request === "string" ? request : request instanceof URL ? request.href : request.url;
      if (init?.method === "POST" && url.includes("/channels/") && typeof init.body === "string") {
        const body = JSON.parse(init.body) as { content: string; nonce?: string };
        return Response.json({
          id: "900000000000000099",
          channel_id: TEST_TOPOLOGY.discordThreadId,
          content: body.content,
          nonce: body.nonce,
        });
      }
      return Response.json([]);
    }),
  );
  try {
    await workflows.modifyAll(async (modifier) => modifier.disableRetryDelays());
    for (const payload of [
      { text: "Pre-deploy answer", idempotencyKey, translate: "es", mode: "send" },
      { text: "Pre-deploy answer", idempotencyKey, translate: "es" },
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
    for (const conflicting of [
      { text: "Different text", idempotencyKey, translate: "es" },
      { text: "Pre-deploy answer", idempotencyKey, translate: "off" },
    ]) {
      const conflict = await app.request(
        `/v1/agent/threads/${customer.threadId}/replies`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(conflicting),
        },
        apiEnv,
      );
      expect(conflict.status).toBe(409);
    }

    // Reusing a dropped draft's idempotencyKey post-0012 gets a fresh v2 messageId/workflowId and delivers.
    const reused = await app.request(
      `/v1/agent/threads/${customer.threadId}/replies`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: "Fresh send reusing dropped key",
          idempotencyKey: droppedDraftKey,
          translate: "off",
        }),
      },
      apiEnv,
    );
    expect(reused.status).toBe(202);
    const reusedBody = await reused.json<{ messageId: string }>();
    expect(reusedBody.messageId).not.toBe(v1DroppedMessageId);

    const instances = await workflows.get();
    for (const instance of instances) await instance.waitForStatus("complete");
    expect(
      await env.DB.prepare(
        "SELECT count(*) n FROM message WHERE thread_id=? AND author_kind='agent'",
      )
        .bind(customer.threadId)
        .first("n"),
    ).toBe(2);
    expect(
      await env.DB.prepare("SELECT customer_visible_text FROM message WHERE id=?")
        .bind(reusedBody.messageId)
        .first("customer_visible_text"),
    ).toBe("Fresh send reusing dropped key");
  } finally {
    vi.unstubAllGlobals();
    await workflows.dispose();
  }
});
