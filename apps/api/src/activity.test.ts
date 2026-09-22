import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  ActivityError,
  activityConnection,
  fetchActivity,
  formatActivity,
} from "./activity-service";
import { handleActivityInteraction } from "./discord-activity";
import { createHttpApp } from "./http";
import {
  createCustomerFixture,
  createTestEnv,
  seedReadyDiscordThread,
  seedTopology,
  snowflakeAt,
  TEST_TOPOLOGY,
} from "../test/fixtures";
import { acceptCustomerIngress } from "@respondkit/conversations";
import {
  deriveCustomerMessageIdentity,
  InboxIdSchema,
  WorkspaceIdSchema,
  type ClientMessageId,
} from "@respondkit/protocol";
import { createDatabase } from "./db";

const connection = {
  host: "https://eu.posthog.com" as const,
  projectId: 57374,
  endpoint: "respondkit_customer_activity_v1",
  version: 2,
};
const now = Math.floor(Date.now() / 1000) * 1000;
const columns = [
  "uuid",
  "timestamp",
  "event",
  "distinct_id",
  "session_id",
  "page_path",
  "surface",
  "app_version",
  "error_code",
  "error_type",
  "input_type",
  "pipeline_mode",
];
function row(id = "one", timestamp = now - 10000, distinctId = "customer", event = "$pageview") {
  return [
    id,
    new Date(timestamp).toISOString(),
    event,
    distinctId,
    "session",
    "/editor?token=private#fragment",
    "web",
    null,
    null,
    null,
    null,
    null,
  ];
}
function input() {
  return {
    connection,
    apiKey: "server-secret",
    distinctId: "customer",
    end: now,
    options: { count: 2, minutes: 30, activityKind: "all" as const },
  };
}
function command() {
  return {
    kind: "command" as const,
    command: "activity" as const,
    interactionId: snowflakeAt(now),
    applicationId: TEST_TOPOLOGY.applicationId,
    token: "private-interaction-token",
    guildId: TEST_TOPOLOGY.guildId,
    discordThreadId: TEST_TOPOLOGY.discordThreadId,
    forumChannelId: TEST_TOPOLOGY.forumChannelId,
    threadType: 11,
    operatorUserId: TEST_TOPOLOGY.operatorId,
    operatorRoleIds: [TEST_TOPOLOGY.operatorRoleId],
    count: 20,
    minutes: 30,
    activityKind: "all" as const,
    until: "now" as const,
  };
}
function apiEnv() {
  return createTestEnv({
    POSTHOG_ACTIVITY_INBOXES: JSON.stringify({ [TEST_TOPOLOGY.inboxId]: connection }),
    [`POSTHOG_API_KEY_${TEST_TOPOLOGY.inboxId}`]: "server-secret",
  });
}
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await seedTopology();
});

describe("PostHog activity service", () => {
  it("pins the configured endpoint, uses a fresh bounded window and returns the latest N chronologically", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        columns,
        endpoint_version: 2,
        results: [row("new", now - 1000), row("old", now - 2000), row("overflow", now - 3000)],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchActivity(input());
    expect(result.events.map((x) => x.id)).toEqual(["old", "new"]);
    expect(result.truncated).toBe(true);
    expect(result.events[0]?.path).toBe("/editor");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${connection.host}/api/projects/57374/endpoints/${connection.endpoint}/run/`);
    expect(JSON.parse(init.body as string)).toMatchObject({
      refresh: "force",
      version: 2,
      variables: {
        respondkit_distinct_id: "customer",
        respondkit_row_limit: 3,
        respondkit_event_kind: "all",
        respondkit_start_time: new Date(now - 1800000).toISOString().slice(0, 19).replace("T", " "),
      },
    });
    expect(init.redirect).toBe("error");
  });
  it.each(
    [
      row("bad", now - 1000, "another-customer"),
      row("bad", now + 1000),
      row("bad", now - 31 * 60000),
      row("bad", now - 1000, "customer", "$set"),
    ].map((value) => [value]),
  )("rejects out-of-scope results", async (bad) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ columns, results: [bad] })),
    );
    await expect(fetchActivity(input())).rejects.toThrow("unexpected activity data");
  });
  it("rejects pageview filter violations and schema drift", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          columns,
          results: [row("bad", now - 1000, "customer", "video_explain_failed")],
        }),
      ),
    );
    await expect(
      fetchActivity({ ...input(), options: { ...input().options, activityKind: "pageviews" } }),
    ).rejects.toThrow(ActivityError);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ columns: ["other"], results: [] })),
    );
    await expect(fetchActivity(input())).rejects.toThrow(ActivityError);
  });
  it.each([401, 403, 429, 500])(
    "reports HTTP %s without leaking provider bodies",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("server-secret private analytics", { status })),
      );
      await expect(fetchActivity(input())).rejects.toThrow(`HTTP ${status}`);
      try {
        await fetchActivity(input());
      } catch (error) {
        expect(String(error)).not.toContain("server-secret");
      }
    },
  );
  it("keeps missing credentials/identity and unsupported projects local", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    expect(() => activityConnection(apiEnv(), "another-inbox")).toThrow("not configured");
    await expect(fetchActivity({ ...input(), distinctId: "" })).rejects.toThrow("no valid PostHog");
    expect(mock).not.toHaveBeenCalled();
  });
  it("handles network timeouts with a retryable operator message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timeout", "TimeoutError");
      }),
    );
    await expect(fetchActivity(input())).rejects.toThrow("Run /activity again");
  });
  it("formats large timelines safely with a complete attachment and UTC fallback", () => {
    const formatted = formatActivity(
      {
        events: Array.from({ length: 100 }, (_, i) => ({
          id: String(i),
          timestamp: now - i * 1000,
          event: "video_failed",
          path: "/editor",
          details: "error_code: " + "x".repeat(60),
        })),
        truncated: true,
        count: 100,
        start: now - 600000,
        end: now,
        kind: "all",
      },
      "@everyone **id**",
      "invalid-zone",
      "https://eu.posthog.com/project/57374/activity/explore",
    );
    expect(formatted.content.length).toBeLessThanOrEqual(2000);
    expect(formatted.content).toContain("(UTC)");
    expect(formatted.content).not.toContain("@everyone");
    expect(formatted.file?.match(/video_failed/g)).toHaveLength(100);
  });
});

async function fixture() {
  const customer = await createCustomerFixture();
  await seedReadyDiscordThread(customer.threadId);
  const visitor = await env.DB.prepare(
    "SELECT v.posthog_distinct_id FROM visitor v JOIN thread t ON t.visitor_id=v.id WHERE t.id=?",
  )
    .bind(customer.threadId)
    .first<{ posthog_distinct_id: string }>();
  return { ...customer, distinctId: visitor!.posthog_distinct_id };
}
function mockServices(
  distinctId: string,
  status = 200,
  results = [row("event", now - 10000, distinctId)],
) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).startsWith(connection.host))
        return Response.json({ columns, results }, { status });
      if (init?.method === "PATCH") return Response.json({});
      return Response.json({ id: "100000000000000088" });
    }),
  );
  return calls;
}

describe("Discord activity", () => {
  it("posts only to the authorized Discord thread, suppresses mentions and leaves the transcript untouched", async () => {
    const f = await fixture();
    const calls = mockServices(f.distinctId);
    await handleActivityInteraction(apiEnv(), command());
    const post = calls.find((c) => c.url.includes("/channels/"))!;
    const form = post.init!.body as FormData;
    const payload = JSON.parse(form.get("payload_json") as string);
    expect(post.url).toContain(TEST_TOPOLOGY.discordThreadId);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.enforce_nonce).toBe(true);
    expect(payload.content).toContain("/editor");
    expect(payload.content).not.toContain("token=private");
    const count = await env.DB.prepare("SELECT count(*) as n FROM message").first<{ n: number }>();
    expect(count?.n).toBe(0);
    expect(calls.at(-1)?.init?.body).toContain("Activity posted:");
  });
  it.each([
    { operatorUserId: "100000000000000099", operatorRoleIds: [] },
    { guildId: "100000000000000099" },
    { forumChannelId: "100000000000000099" },
    { discordThreadId: "100000000000000099" },
    { threadType: 0 },
    { applicationId: "100000000000000099" },
  ])("rejects unauthorized context before querying PostHog", async (override) => {
    const f = await fixture();
    const calls = mockServices(f.distinctId);
    await handleActivityInteraction(apiEnv(), { ...command(), ...override });
    expect(calls.every((c) => c.init?.method === "PATCH")).toBe(true);
  });
  it("posts a complete text attachment for long timelines", async () => {
    const f = await fixture();
    const calls = mockServices(
      f.distinctId,
      200,
      Array.from({ length: 100 }, (_, i) => row(`event-${i}`, now - (i + 1) * 1000, f.distinctId)),
    );
    await handleActivityInteraction(apiEnv(), { ...command(), count: 100 });
    const form = calls.find((c) => c.url.includes("/channels/"))!.init!.body as FormData;
    const payload = JSON.parse(form.get("payload_json") as string);
    expect(payload.content.length).toBeLessThanOrEqual(2000);
    expect(payload.attachments).toEqual([{ id: 0, filename: "customer-activity.txt" }]);
    const attachment = form.get("files[0]") as File;
    expect((await attachment.text()).match(/\$pageview/g)).toHaveLength(100);
  });
  it("does not query without a recorded identity or configured credential", async () => {
    const f = await fixture();
    const calls = mockServices(f.distinctId);
    await handleActivityInteraction(
      { ...apiEnv(), [`POSTHOG_API_KEY_${TEST_TOPOLOGY.inboxId}`]: undefined },
      command(),
    );
    expect(calls.at(-1)?.init?.body).toContain("credential is missing");
    await env.DB.prepare("UPDATE visitor SET posthog_distinct_id = NULL").run();
    await handleActivityInteraction(apiEnv(), command());
    expect(calls.at(-1)?.init?.body).toContain("no PostHog distinct ID");
    expect(calls.every((c) => c.init?.method === "PATCH")).toBe(true);
  });
  it("keeps provider errors private", async () => {
    const f = await fixture();
    const calls = mockServices(f.distinctId, 403);
    await handleActivityInteraction(apiEnv(), command());
    expect(calls.some((c) => c.url.includes("/channels/"))).toBe(false);
    expect(calls.at(-1)?.init?.body).toContain("HTTP 403");
  });
  it("anchors a historical window to the latest customer message", async () => {
    const f = await fixture();
    const acceptedAt = new Date(now - 86400000);
    const scope = {
      workspaceId: WorkspaceIdSchema.parse(TEST_TOPOLOGY.workspaceId),
      inboxId: InboxIdSchema.parse(TEST_TOPOLOGY.inboxId),
      threadId: f.threadId,
    };
    const clientMessageId = `client_${crypto.randomUUID()}` as ClientMessageId;
    const identity = await deriveCustomerMessageIdentity({ ...scope, clientMessageId });
    await acceptCustomerIngress(createDatabase(env.DB), {
      ...scope,
      id: identity.messageId,
      clientMessageId,
      workflowInstanceId: identity.workflowInstanceId,
      originalText: "help",
      acceptedAt,
    });
    const calls = mockServices(f.distinctId, 200, [
      row("old", acceptedAt.getTime() - 1000, f.distinctId),
    ]);
    await handleActivityInteraction(apiEnv(), { ...command(), until: "last_message" });
    expect(JSON.parse(calls[0]?.init?.body as string).variables.respondkit_end_time).toBe(
      acceptedAt.toISOString().slice(0, 19).replace("T", " "),
    );
  });
  it("requires a message for the historical anchor", async () => {
    const f = await fixture();
    const calls = mockServices(f.distinctId);
    await handleActivityInteraction(apiEnv(), { ...command(), until: "last_message" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.body).toContain("no customer message");
  });
  it("defers signed /activity requests privately before background work finishes", async () => {
    const f = await fixture();
    mockServices(f.distinctId);
    const keys = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const hex = (bytes: ArrayBuffer) =>
      [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const c = command();
    const raw = JSON.stringify({
      id: c.interactionId,
      application_id: c.applicationId,
      type: 2,
      token: c.token,
      guild_id: c.guildId,
      channel_id: c.discordThreadId,
      channel: { type: 11, parent_id: c.forumChannelId },
      member: { user: { id: c.operatorUserId }, roles: c.operatorRoleIds },
      data: { name: "activity", type: 1, options: [{ name: "count", type: 4, value: 5 }] },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = hex(
      await crypto.subtle.sign(
        "Ed25519",
        keys.privateKey,
        new TextEncoder().encode(timestamp + raw),
      ),
    );
    const ctx = createExecutionContext();
    const response = await createHttpApp().request(
      "/v1/discord/interactions",
      {
        method: "POST",
        headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp },
        body: raw,
      },
      {
        ...apiEnv(),
        DISCORD_PUBLIC_KEY: hex(await crypto.subtle.exportKey("raw", keys.publicKey)),
      },
      ctx,
    );
    expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });
    await waitOnExecutionContext(ctx);
  });
});
