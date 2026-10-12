import { applyD1Migrations, env, reset, type D1Migration } from "cloudflare:test";
import { expect, it } from "vite-plus/test";
import { seedTopology, TEST_TOPOLOGY } from "../test/fixtures";

declare const __D1_MIGRATIONS__: D1Migration[];

it("upgrades existing 0008 data with 0009 and preserves customer and operator transcripts", async () => {
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
      "SELECT claimed_by,claim_expires_at FROM thread WHERE id='legacy-thread'",
    ).first(),
  ).toEqual({ claimed_by: null, claim_expires_at: null });
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

it("upgrades populated 0009 to 0010 without changing customer data or existing claims, drafts and limits", async () => {
  await reset();
  await applyD1Migrations(
    env.DB,
    __D1_MIGRATIONS__.filter((migration) => migration.name < "0010"),
  );
  await seedTopology();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO visitor(id,workspace_id,inbox_id,installation_id) VALUES ('v9',?,?,'v9')",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId),
    env.DB.prepare(
      "INSERT INTO thread(id,workspace_id,inbox_id,visitor_id,client_thread_id,claimed_by,claim_expires_at,customer_language) VALUES ('t9',?,?,'v9','t9','existing-run',9999999999999,'fr')",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId),
    env.DB.prepare(
      "INSERT INTO message(id,workspace_id,inbox_id,thread_id,workflow_instance_id,direction,original_text,customer_visible_text,client_message_id,accepted_at) VALUES ('m9',?,?,'t9','w9','customer_to_operator','Question','Question','c9',1000)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId),
    env.DB.prepare(
      "INSERT INTO message(id,workspace_id,inbox_id,thread_id,workflow_instance_id,direction,original_text,customer_visible_text,author_kind,accepted_at) VALUES ('o9',?,?,'t9','wo9','operator_to_customer','Reply','Reply','operator',1000)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId),
    env.DB.prepare(
      "INSERT INTO agent_reply(message_id,workspace_id,inbox_id,thread_id,idempotency_key,request_json,envelope,mode,status,basis_row_id,created_at) VALUES ('draft9',?,?,'t9','draft9','{}','{}','draft','pending',2,1000)",
    ).bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId),
    env.DB.prepare("INSERT INTO agent_rate_limit VALUES ('existing-hash',123,7)"),
  ]);
  const tables = [
    "visitor",
    "thread",
    "message",
    "customer_transcript_entry",
    "agent_reply",
    "agent_rate_limit",
  ];
  const before = await Promise.all(
    tables.map((table) => env.DB.prepare(`SELECT * FROM ${table}`).all()),
  );
  await applyD1Migrations(env.DB, __D1_MIGRATIONS__);
  const after = await Promise.all(
    tables.map((table) => env.DB.prepare(`SELECT * FROM ${table}`).all()),
  );
  expect(after.map((r) => r.results)).toEqual(before.map((r) => r.results));
  expect(
    (
      await env.DB.prepare(
        "SELECT sequence,message_id,author_kind FROM agent_timeline ORDER BY sequence",
      ).all()
    ).results,
  ).toEqual([
    { sequence: 1, message_id: "m9", author_kind: "customer" },
    { sequence: 2, message_id: "o9", author_kind: "operator" },
  ]);
  expect(await env.DB.prepare("SELECT count(*) n FROM agent_ack").first("n")).toBe(0);
  await env.DB.prepare(
    "INSERT INTO internal_note(id,workspace_id,inbox_id,thread_id,author_kind,author_name,kind,text,request_json,created_at) VALUES ('n10',?,?,'t9','operator','Simon','steer','Investigate','{}',1000)",
  )
    .bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId)
    .run();
  expect(
    await env.DB.prepare("SELECT ordering_key FROM internal_note WHERE id='n10'").first(
      "ordering_key",
    ),
  ).toBe(3);
  expect(
    await env.DB.prepare("SELECT status FROM agent_reply WHERE message_id='draft9'").first(
      "status",
    ),
  ).toBe("stale");
  await env.DB.prepare(
    "INSERT INTO message(id,workspace_id,inbox_id,thread_id,workflow_instance_id,direction,original_text,customer_visible_text,client_message_id,accepted_at) VALUES ('m10',?,?,'t9','w10','customer_to_operator','Later','Later','c10',500)",
  )
    .bind(TEST_TOPOLOGY.workspaceId, TEST_TOPOLOGY.inboxId)
    .run();
  expect(
    await env.DB.prepare("SELECT sequence FROM agent_timeline WHERE message_id='m10'").first(
      "sequence",
    ),
  ).toBe(4);
  expect(await env.DB.prepare("SELECT count(*) n FROM message WHERE id='n10'").first("n")).toBe(0);
});
