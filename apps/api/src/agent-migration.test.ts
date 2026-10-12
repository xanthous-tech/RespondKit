import { applyD1Migrations, env, reset, type D1Migration } from "cloudflare:test";
import { expect, it } from "vite-plus/test";
import { seedTopology, TEST_TOPOLOGY } from "../test/fixtures";

declare const __D1_MIGRATIONS__: D1Migration[];

it("upgrades existing 0008 data with 0009 and preserves customer and operator transcripts", async () => {
  await reset();
  await applyD1Migrations(env.DB, __D1_MIGRATIONS__.slice(0, -1));
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
