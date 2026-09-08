import {
  CreateClientSessionResponseV1Schema,
  CreateThreadResponseV1Schema,
  ListThreadsResponseV1Schema,
  ListThreadStatusesResponseV1Schema,
} from "@respondkit/protocol";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { createHttpApp } from "./http";
import { verifyCustomerIdentity } from "./customer-identity";
import { createTestEnv, seedTopology, TEST_ORIGIN, TEST_TOPOLOGY } from "../test/fixtures";
import { identityToken, IDENTITY_TEST_KEY } from "../test/identity";

const signingKeys = JSON.stringify({ [TEST_TOPOLOGY.inboxId]: IDENTITY_TEST_KEY });
const app = createHttpApp();
function request(path: string, body?: unknown, token?: string) {
  return app.request(
    path,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin: TEST_ORIGIN,
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    createTestEnv({ IDENTITY_SIGNING_KEYS: signingKeys }),
  );
}
async function session(
  installationId: string,
  assertion?: string,
  context?: Record<string, string>,
) {
  const response = await request("/v1/client/sessions", {
    inboxId: TEST_TOPOLOGY.inboxId,
    installationId,
    ...(assertion ? { identityToken: assertion } : {}),
    ...(context ? { context } : {}),
  });
  expect(response.status).toBe(201);
  return CreateClientSessionResponseV1Schema.parse(await response.json()).session;
}
async function thread(token: string) {
  const response = await request(
    "/v1/threads",
    { clientThreadId: `client_thread_${crypto.randomUUID()}` },
    token,
  );
  expect(response.status).toBe(201);
  return CreateThreadResponseV1Schema.parse(await response.json()).thread;
}
async function history(token: string) {
  const response = await request("/v1/threads", undefined, token);
  expect(response.status).toBe(200);
  return ListThreadsResponseV1Schema.parse(await response.json());
}

beforeEach(async () => {
  await seedTopology();
});

describe("verified customer history", () => {
  it("preserves an anonymous conversation through login and restores it from a fresh browser", async () => {
    const anonymous = await session("install_browser_a", undefined, {
      posthogDistinctId: "ph_anon",
      posthogSessionId: "ph_session_1",
    });
    const original = await thread(anonymous.token);
    const alice = await session("install_browser_a", await identityToken(), {
      userId: "alice",
      posthogDistinctId: "alice",
      posthogSessionId: "ph_session_2",
    });
    expect(alice.visitorId).toBe(anonymous.visitorId);
    expect((await history(alice.token)).threads.map((t) => t.id)).toEqual([original.id]);
    const fresh = await session("install_browser_b", await identityToken());
    expect(fresh.visitorId).not.toBe(alice.visitorId);
    const statuses = await request("/v1/thread-statuses", undefined, fresh.token);
    expect(statuses.headers.get("cache-control")).toBe("private, no-store");
    expect(ListThreadStatusesResponseV1Schema.parse(await statuses.json()).threads).toEqual([
      { thread: original, latestReplyCursor: "0" },
    ]);
    expect((await history(fresh.token)).threads.map((t) => t.id)).toEqual([original.id]);
    expect(
      (await request(`/v1/threads/${original.id}/messages`, undefined, fresh.token)).status,
    ).toBe(200);
    const aliases = await env.DB.prepare(
      "select kind, value from visitor_alias where visitor_id = ? order by kind, value",
    )
      .bind(alice.visitorId)
      .all();
    expect(aliases.results).toEqual(
      expect.arrayContaining([
        { kind: "posthog_distinct_id", value: "ph_anon" },
        { kind: "posthog_distinct_id", value: "alice" },
        { kind: "posthog_session_id", value: "ph_session_1" },
        { kind: "posthog_session_id", value: "ph_session_2" },
      ]),
    );
    expect((await request("/v1/threads", undefined, anonymous.token)).status).toBe(401);
    expect((await request("/v1/thread-statuses", undefined, anonymous.token)).status).toBe(401);
    expect((await request("/v1/thread-statuses")).status).toBe(401);
  });

  it("does not grant history through raw user IDs, matching PostHog aliases, or another account", async () => {
    const alice = await session("install_alice", await identityToken(), {
      posthogDistinctId: "shared",
    });
    const original = await thread(alice.token);
    const impostor = await session("install_impostor", undefined, {
      userId: "alice",
      posthogDistinctId: "shared",
    });
    const bob = await session("install_bob", await identityToken({ sub: "bob" }));
    for (const token of [impostor.token, bob.token]) {
      expect((await history(token)).threads).toEqual([]);
      const statuses = await request("/v1/thread-statuses", undefined, token);
      expect(ListThreadStatusesResponseV1Schema.parse(await statuses.json()).threads).toEqual([]);
      expect((await request(`/v1/threads/${original.id}/messages`, undefined, token)).status).toBe(
        404,
      );
      expect(
        (
          await request(
            `/v1/threads/${original.id}/messages`,
            { clientMessageId: "client_message_attack", text: "attack" },
            token,
          )
        ).status,
      ).toBe(404);
    }
    for (const assertion of [undefined, await identityToken({ sub: "bob" })]) {
      expect(
        (
          await request("/v1/client/sessions", {
            inboxId: TEST_TOPOLOGY.inboxId,
            installationId: "install_alice",
            ...(assertion ? { identityToken: assertion } : {}),
          })
        ).status,
      ).toBe(409);
    }
  });

  it("revokes every issued session for that visitor on logout and permits verified re-login", async () => {
    const first = await session("install_alice", await identityToken());
    const second = await session("install_alice", await identityToken());
    const original = await thread(first.token);
    expect((await request("/v1/client/logout", {}, second.token)).status).toBe(200);
    expect((await request("/v1/threads", undefined, first.token)).status).toBe(401);
    expect((await request("/v1/threads", undefined, second.token)).status).toBe(401);
    const again = await session("install_new_login", await identityToken());
    expect((await history(again.token)).threads[0]?.id).toBe(original.id);
  });

  it("converges concurrent logins on one customer without duplicating links", async () => {
    const assertion = await identityToken();
    await Promise.all([
      session("install_one", assertion),
      session("install_two", assertion),
      session("install_one", assertion),
    ]);
    expect(await env.DB.prepare("select count(*) as count from customer").first("count")).toBe(1);
    expect(
      await env.DB.prepare("select count(*) as count from visitor_customer").first("count"),
    ).toBe(2);
  });

  it("rejects mismatched contextual user IDs before creating a visitor", async () => {
    const response = await request("/v1/client/sessions", {
      inboxId: TEST_TOPOLOGY.inboxId,
      installationId: "install_mismatch",
      identityToken: await identityToken(),
      context: { userId: "bob" },
    });
    expect(response.status).toBe(400);
    expect(await env.DB.prepare("select count(*) as count from visitor").first("count")).toBe(0);
  });

  it("rejects expired, forged, wrong-inbox, wrong-audience and long-lived identity assertions", async () => {
    const now = Math.floor(Date.now() / 1000);
    const invalid = await Promise.all([
      identityToken({ exp: now - 1 }),
      identityToken({ inboxId: "inbox_other" }),
      identityToken({ aud: "another-service" }),
      identityToken({ exp: now + 3600 }),
      identityToken({ iat: now + 100, exp: now + 300 }),
      identityToken({}, "another-signing-key-at-least-32-characters"),
      identityToken({}, IDENTITY_TEST_KEY, { alg: "none", typ: "JWT" }),
    ]);
    for (const token of [...invalid, "garbage"]) {
      expect(
        await verifyCustomerIdentity({ token, inboxId: TEST_TOPOLOGY.inboxId, signingKeys }),
      ).toBeNull();
      expect(
        (
          await request("/v1/client/sessions", {
            inboxId: TEST_TOPOLOGY.inboxId,
            installationId: "install_invalid",
            identityToken: token,
          })
        ).status,
      ).toBe(401);
    }
  });
  it("paginates every conversation without duplicates and restores a known thread directly", async () => {
    const alice = await session("install_many", await identityToken());
    await env.DB.batch(
      Array.from({ length: 103 }, (_, index) =>
        env.DB.prepare(
          "insert into thread (id, workspace_id, inbox_id, visitor_id, client_thread_id, created_at, updated_at, last_activity_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          `thread_page_${String(index).padStart(3, "0")}`,
          TEST_TOPOLOGY.workspaceId,
          TEST_TOPOLOGY.inboxId,
          alice.visitorId,
          `client_thread_page_${index}`,
          Date.now(),
          Date.now(),
          Date.now(),
        ),
      ),
    );
    const first = await history(alice.token);
    expect(first.threads).toHaveLength(100);
    const response = await request(`/v1/threads?after=${first.nextCursor}`, undefined, alice.token);
    const second = ListThreadsResponseV1Schema.parse(await response.json());
    expect(second.threads).toHaveLength(3);
    expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.threads, ...second.threads].map((t) => t.id)).size).toBe(103);
    const statusFirst = ListThreadStatusesResponseV1Schema.parse(
      await (await request("/v1/thread-statuses", undefined, alice.token)).json(),
    );
    expect(statusFirst.threads).toHaveLength(100);
    const statusSecond = ListThreadStatusesResponseV1Schema.parse(
      await (
        await request(`/v1/thread-statuses?after=${statusFirst.nextCursor}`, undefined, alice.token)
      ).json(),
    );
    expect(statusSecond.threads.map((item) => item.thread.id)).toEqual(
      second.threads.map((item) => item.id),
    );
    expect(statusSecond.nextCursor).toBeUndefined();
    const direct = await request("/v1/threads/thread_page_102", undefined, alice.token);
    expect(CreateThreadResponseV1Schema.parse(await direct.json()).thread.id).toBe(
      "thread_page_102",
    );
  });

  it("accepts a dedicated inbox secret without replacing the legacy secret map", async () => {
    const response = await app.request(
      "/v1/client/sessions",
      {
        method: "POST",
        headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({
          inboxId: TEST_TOPOLOGY.inboxId,
          installationId: "install_dedicated_key",
          identityToken: await identityToken(),
        }),
      },
      createTestEnv({
        IDENTITY_SIGNING_KEYS: JSON.stringify({ inbox_unrelated: "x".repeat(32) }),
        [`IDENTITY_SIGNING_KEY_${TEST_TOPOLOGY.inboxId}`]: IDENTITY_TEST_KEY,
      }),
    );
    expect(response.status).toBe(201);
    const authorized = CreateClientSessionResponseV1Schema.parse(await response.json());
    expect(authorized.session.token).toBeTruthy();
  });

  it("keeps matching verified user IDs isolated across inboxes", async () => {
    const alice = await session("install_same", await identityToken());
    const firstThread = await thread(alice.token);
    await env.DB.prepare(
      "insert into inbox (id, workspace_id, product_id, name, status, default_locale, created_at, updated_at) select 'inbox_other', workspace_id, product_id, name, status, default_locale, created_at, updated_at from inbox where id = ?",
    )
      .bind(TEST_TOPOLOGY.inboxId)
      .run();
    await env.DB.prepare(
      "insert into allowed_origin (id, workspace_id, inbox_id, origin, created_at) values ('origin_other', ?, 'inbox_other', ?, ?)",
    )
      .bind(TEST_TOPOLOGY.workspaceId, TEST_ORIGIN, Date.now())
      .run();
    const response = await app.request(
      "/v1/client/sessions",
      {
        method: "POST",
        headers: { origin: TEST_ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({
          inboxId: "inbox_other",
          installationId: "install_same",
          identityToken: await identityToken({ inboxId: "inbox_other" }),
        }),
      },
      createTestEnv({ IDENTITY_SIGNING_KEYS: JSON.stringify({ inbox_other: IDENTITY_TEST_KEY }) }),
    );
    expect(response.status).toBe(201);
    const other = CreateClientSessionResponseV1Schema.parse(await response.json()).session;
    expect(other.visitorId).not.toBe(alice.visitorId);
    expect((await history(other.token)).threads).toEqual([]);
    expect(
      ListThreadStatusesResponseV1Schema.parse(
        await (await request("/v1/thread-statuses", undefined, other.token)).json(),
      ).threads,
    ).toEqual([]);
    expect((await request(`/v1/threads/${firstThread.id}`, undefined, other.token)).status).toBe(
      404,
    );
  });
});
