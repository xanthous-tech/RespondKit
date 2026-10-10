import { createDiscordCorrelationMarker } from "../../../packages/discord/src/rest.ts";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const run = resolve(root, `artifacts/of-10-${Date.now()}`);
await mkdir(run, { recursive: true });
const token = randomBytes(32).toString("hex");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicHex = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
const ids = {
  application: "111111111111111111",
  guild: "222222222222222222",
  forum: "333333333333333333",
  operator: "444444444444444444",
  channel: "555555555555555555",
};
const posts = [];
const fixture = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("content-type", "application/json");
  if (url.pathname !== `/api/v10/channels/${ids.channel}/messages`) {
    res.writeHead(404).end(JSON.stringify({ message: "Unexpected fixture route" }));
    return;
  }
  if (req.method === "GET") {
    res.end(JSON.stringify(posts));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end("{}");
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  let posted = posts.find((post) => post.nonce === body.nonce);
  if (!posted) {
    posted = {
      ...body,
      id: String(600000000000000000n + BigInt(posts.length)),
      channel_id: ids.channel,
    };
    posts.push(posted);
  }
  res.end(JSON.stringify(posted));
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const fixturePort = fixture.address().port;
const portProbe = createServer();
await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const config = resolve(run, "wrangler.json");
await writeFile(
  config,
  JSON.stringify(
    {
      name: "respondkit-of-10-local",
      main: resolve(root, "apps/api/src/index.ts"),
      compatibility_date: "2026-08-25",
      vars: {
        ENVIRONMENT: "development",
        GEMINI_MODEL: "unused",
        DISCORD_API_BASE_URL: `http://127.0.0.1:${fixturePort}/api/v10`,
        DISCORD_APPLICATION_ID: ids.application,
        DISCORD_PUBLIC_KEY: publicHex,
        TRANSLATION_ENABLED_INBOXES: "[]",
        AGENT_NAME_inbox_of10: "Local helper",
      },
      d1_databases: [
        {
          binding: "DB",
          database_name: "respondkit-of-10-local",
          database_id: "00000000-0000-0000-0000-000000000009",
          migrations_dir: resolve(root, "apps/api/migrations"),
        },
      ],
      workflows: [
        {
          name: "respondkit-of10-message",
          binding: "MESSAGE_WORKFLOW",
          class_name: "MessageWorkflow",
        },
        {
          name: "respondkit-of10-translation",
          binding: "TRANSLATION_WORKFLOW",
          class_name: "TranslationWorkflow",
        },
      ],
    },
    null,
    2,
  ),
);
await writeFile(
  resolve(run, ".dev.vars"),
  `SESSION_SIGNING_KEY=${randomBytes(32).toString("hex")}\nDISCORD_BOT_TOKEN=${randomBytes(32).toString("hex")}\nAGENT_TOKEN_inbox_of10=${createHash("sha256").update(token).digest("hex")}\n`,
  { mode: 0o600 },
);
const cwd = resolve(root, "apps/api");
const persist = resolve(run, "state");
async function wrangler(args) {
  return exec("pnpm", ["exec", "wrangler", ...args, "--config", config, "--persist-to", persist], {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });
}
await wrangler(["d1", "migrations", "apply", "respondkit-of-10-local", "--local"]);
async function sql(command) {
  const result = await wrangler([
    "d1",
    "execute",
    "respondkit-of-10-local",
    "--local",
    "--command",
    command,
    "--json",
  ]);
  return JSON.parse(result.stdout).flatMap((entry) => entry.results);
}
await sql(`INSERT INTO workspace(id,slug,name) VALUES ('workspace_of10','of10','OF-10 local');
INSERT INTO product(id,workspace_id,slug,name) VALUES ('product_of10','workspace_of10','of10','OF-10');
INSERT INTO inbox(id,workspace_id,product_id,name) VALUES ('inbox_of10','workspace_of10','product_of10','Local verification');
INSERT INTO allowed_origin(id,workspace_id,inbox_id,origin) VALUES ('origin_of10','workspace_of10','inbox_of10','http://localhost:4173');
INSERT INTO discord_integration(id,workspace_id,inbox_id,application_id,guild_id,forum_channel_id) VALUES ('discord_of10','workspace_of10','inbox_of10','${ids.application}','${ids.guild}','${ids.forum}');
INSERT INTO discord_operator_allowlist(integration_id,workspace_id,principal_type,principal_id) VALUES ('discord_of10','workspace_of10','user','${ids.operator}');`);
const worker = spawn(
  "pnpm",
  [
    "exec",
    "wrangler",
    "dev",
    "--local",
    "--config",
    config,
    "--persist-to",
    persist,
    "--port",
    String(port),
    "--inspector-port",
    "0",
  ],
  {
    cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  },
);
let workerLog = "";
worker.stdout.on("data", (chunk) => {
  workerLog += chunk;
});
worker.stderr.on("data", (chunk) => {
  workerLog += chunk;
});
const evidence = [];
const base = `http://127.0.0.1:${port}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function curl(path, { method = "GET", body, headers = {}, label = path } = {}) {
  const args = [
    "--silent",
    "--show-error",
    "--max-time",
    "30",
    "-X",
    method,
    "-w",
    "\n%{http_code}",
    `${base}${path}`,
  ];
  for (const [key, value] of Object.entries(headers)) args.push("-H", `${key}: ${value}`);
  if (body !== undefined)
    args.push(
      "-H",
      "content-type: application/json",
      "--data-binary",
      typeof body === "string" ? body : JSON.stringify(body),
    );
  const { stdout } = await exec("curl", args);
  const last = stdout.lastIndexOf("\n");
  const status = Number(stdout.slice(last + 1));
  const data = JSON.parse(stdout.slice(0, last));
  if (label)
    evidence.push({
      request: `${method} ${label}`,
      status,
      data: JSON.parse(
        JSON.stringify(data, (key, value) => (key === "token" ? "<redacted>" : value)),
      ),
    });
  assert(status < 400, `${method} ${path}: HTTP ${status} ${JSON.stringify(data)}`);
  return data;
}
const agentHeaders = { authorization: `Bearer ${token}`, "x-agent-run-id": "walkthrough" };
async function agent(path, body, label = path) {
  return curl(`/v1/agent${path}`, {
    method: body === undefined ? "GET" : "POST",
    body,
    headers: agentHeaders,
    label,
  });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch (error) {
      if (worker.exitCode !== null) throw new Error(workerLog, { cause: error });
    }
    await delay(200);
  }
  assert(ready, workerLog);
  const session = await curl("/v1/client/sessions", {
    method: "POST",
    headers: { origin: "http://localhost:4173" },
    body: {
      inboxId: "inbox_of10",
      installationId: "of10-local-curl",
      context: {
        userId: "of10-customer",
        email: "customer@example.test",
        locale: "en",
        metadata: { platform: "web", plan: "test" },
      },
    },
  });
  const customerHeaders = {
    authorization: `Bearer ${session.session.token}`,
    origin: "http://localhost:4173",
  };
  const created = await curl("/v1/threads", {
    method: "POST",
    headers: customerHeaders,
    body: { clientThreadId: "of10-thread" },
  });
  const threadId = created.thread.id;
  await sql(
    `INSERT INTO discord_thread(thread_id,workspace_id,inbox_id,integration_id,discord_thread_id,state,correlation_marker) VALUES ('${threadId}','workspace_of10','inbox_of10','discord_of10','${ids.channel}','ready','${createDiscordCorrelationMarker(threadId)}');`,
  );
  await curl(`/v1/threads/${threadId}/messages`, {
    method: "POST",
    headers: customerHeaders,
    body: { clientMessageId: "of10-question", text: "How can I export my transcript?" },
  });
  for (let attempt = 0; attempt < 100 && posts.length < 1; attempt++) await delay(100);
  assert.equal(Number(posts.length), 1);
  const listed = await agent("/threads?needsReply=1&state=open");
  assert.equal(listed.threads[0]?.id, threadId);
  await agent(`/threads/${threadId}`);
  await agent(`/threads/${threadId}/claim`, { leaseSeconds: 300 });
  const body = {
    text: "Open the transcript and choose Export.",
    idempotencyKey: "of10-send",
    mode: "send",
  };
  const sent = await agent(`/threads/${threadId}/replies`, body);
  for (let attempt = 0; attempt < 100 && posts.length < 2; attempt++) await delay(100);
  assert.equal(Number(posts.length), 2);
  assert.match(posts[1].content, /\*\*Agent Local helper\*\*/);
  const replay = await agent(`/threads/${threadId}/replies`, body);
  assert.equal(replay.messageId, sent.messageId);
  assert.equal(replay.status, "available");
  const drafted = await agent(`/threads/${threadId}/replies`, {
    text: "You can export as text or subtitles.",
    idempotencyKey: "of10-draft",
    mode: "draft",
  });
  for (let attempt = 0; attempt < 100 && posts.length < 3; attempt++) await delay(100);
  assert.equal(Number(posts.length), 3);
  const buttons = posts[2].components[0].components;
  assert.deepEqual(
    buttons.map((button) => button.label),
    ["Approve", "Reject"],
  );
  const before = await curl(`/v1/threads/${threadId}/messages`, { headers: customerHeaders });
  assert(!JSON.stringify(before).includes("You can export as text or subtitles."));
  const interaction = JSON.stringify({
    id: String((BigInt(Date.now()) - 1420070400000n) << 22n),
    application_id: ids.application,
    token: "local-signed-interaction",
    type: 3,
    guild_id: ids.guild,
    channel_id: ids.channel,
    channel: { type: 11, parent_id: ids.forum },
    member: { user: { id: ids.operator }, roles: [] },
    data: { custom_id: buttons[0].custom_id, component_type: 2 },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.from(timestamp + interaction), privateKey).toString("hex");
  await curl("/v1/discord/interactions", {
    method: "POST",
    body: interaction,
    headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp },
  });
  for (let attempt = 0; attempt < 100 && posts.length < 4; attempt++) await delay(100);
  assert.equal(Number(posts.length), 4);
  const after = await curl(`/v1/threads/${threadId}/messages`, { headers: customerHeaders });
  assert(JSON.stringify(after).includes("You can export as text or subtitles."));
  await curl("/v1/discord/interactions", {
    method: "POST",
    body: interaction,
    headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp },
  });
  const unanswered = await agent("/threads?needsReply=1&state=open");
  assert.equal(unanswered.threads.length, 0);
  await agent(`/threads/${threadId}/close`, {});
  const stored = await sql(
    `SELECT status,claimed_by FROM thread WHERE id='${threadId}'; SELECT id,author_kind,author_name,customer_visible_text,processing_status FROM message WHERE thread_id='${threadId}' ORDER BY row_id; SELECT status,decided_by FROM agent_reply WHERE message_id='${drafted.messageId}';`,
  );
  assert.equal(stored[0].status, "closed");
  assert.equal(stored.at(-1).status, "approved");
  assert.equal(Number(posts.length), 4);
  const doc = `# OF-10 operator API verification\n\nRun: ${new Date().toISOString()}\n\nExecuted \`node apps/api/scripts/verify-agent-api.mjs\` against \`wrangler dev --local\`, using the real Hono Worker, D1 migrations 0000–0009, and MessageWorkflow. HTTP calls below were made with curl. A loopback Discord REST fixture captured posts; Ed25519 keys and agent/session credentials were generated for this run and are redacted. The ready Discord mapping was seeded locally. No remote database, Discord channel, email provider, Gemini service, or deployed Worker was touched.\n\n## Curl transcript\n\n${evidence.map((entry) => `### ${entry.request}\n\nHTTP ${entry.status}\n\n\`\`\`json\n${JSON.stringify(entry.data, null, 2)}\n\`\`\`\n`).join("\n")}\n## Discord posts captured\n\n\`\`\`json\n${JSON.stringify(posts, null, 2)}\n\`\`\`\n\n## D1 readback\n\n\`\`\`json\n${JSON.stringify(stored, null, 2)}\n\`\`\`\n\nAssertions passed: customer-created thread; unanswered listing; full read; claim; send; same-key replay; operator-only draft with Approve/Reject; signed allowlisted approval; customer-visible approved reply; duplicate approval without duplicate delivery; unanswered list empty; close persisted.\n`;
  await mkdir(resolve(root, "docs/verification"), { recursive: true });
  await writeFile(resolve(root, "docs/verification/of-10-agent-api.md"), doc);
  console.log(
    `OF-10 local walkthrough passed (${evidence.length} curl calls, ${posts.length} Discord posts).`,
  );
} finally {
  stopWorker();
  await new Promise((resolve) => fixture.close(resolve));
  await writeFile(resolve(run, "worker.log"), workerLog);
}

function stopWorker() {
  if (typeof worker.pid !== "number") return;
  try {
    process.kill(-worker.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
