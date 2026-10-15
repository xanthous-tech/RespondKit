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
const run = resolve(root, `artifacts/of-19-followup-${Date.now()}`);
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
const translationRequests = [];
const translatedText = "Voici la réponse française approuvée.";
const fixture = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/gemini") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    translationRequests.push(JSON.parse(raw));
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  text: JSON.stringify({
                    sourceLanguage: "en",
                    targetLanguage: "fr",
                    translatedText,
                    needsReview: true,
                    mixedLanguage: false,
                    ambiguityNotes: ["Verify the export wording."],
                  }),
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 },
      }),
    );
    return;
  }
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
const entry = resolve(run, "local-worker.ts");
await writeFile(
  entry,
  `import worker from ${JSON.stringify(resolve(root, "apps/api/src/index.ts"))};
export { MessageWorkflow, TranslationWorkflow } from ${JSON.stringify(resolve(root, "apps/api/src/index.ts"))};
const fetchOriginal = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://generativelanguage.googleapis.com/"))
    return fetchOriginal("http://127.0.0.1:${fixturePort}/gemini", init);
  if (url.startsWith("http://127.0.0.1:${fixturePort}/")) return fetchOriginal(input, init);
  throw new Error("External requests are forbidden in this local walkthrough");
};
export default worker;
`,
);
await writeFile(
  config,
  JSON.stringify(
    {
      name: "respondkit-of-10-local",
      main: entry,
      compatibility_date: "2026-08-25",
      vars: {
        ENVIRONMENT: "development",
        GEMINI_MODEL: "gemini-3.1-flash-lite",
        DISCORD_API_BASE_URL: `http://127.0.0.1:${fixturePort}/api/v10`,
        DISCORD_APPLICATION_ID: ids.application,
        DISCORD_PUBLIC_KEY: publicHex,
        TRANSLATION_ENABLED_INBOXES: '["inbox_of10"]',
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
  `GEMINI_API_KEY=local-fixture-only\nSESSION_SIGNING_KEY=${randomBytes(32).toString("hex")}\nDISCORD_BOT_TOKEN=${randomBytes(32).toString("hex")}\nAGENT_TOKEN_inbox_of10=${createHash("sha256").update(token).digest("hex")}\n`,
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
async function curl(
  path,
  { method = "GET", body, headers = {}, label = path, expectedStatus } = {},
) {
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
  if (expectedStatus !== undefined) assert.equal(status, expectedStatus);
  else assert(status < 400, `${method} ${path}: HTTP ${status} ${JSON.stringify(data)}`);
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
async function signedCommand(
  data,
  {
    type = 2,
    member = { user: { id: ids.operator, username: "Local operator" }, roles: [] },
    channel = ids.channel,
    label = data.name ?? "draft button",
    id,
  } = {},
) {
  const raw = JSON.stringify({
    id: id ?? String((BigInt(Date.now()) - 1420070400000n) << 22n),
    application_id: ids.application,
    token: "local-signed-interaction",
    type,
    guild_id: ids.guild,
    channel_id: channel,
    channel: { type: 11, parent_id: ids.forum },
    member,
    data,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  return curl("/v1/discord/interactions", {
    method: "POST",
    body: raw,
    label: `/v1/discord/interactions (${label})`,
    headers: {
      "x-signature-ed25519": sign(null, Buffer.from(timestamp + raw), privateKey).toString("hex"),
      "x-signature-timestamp": timestamp,
    },
  });
}
async function waitFor(check, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  assert.fail(`Timed out: ${label}`);
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
  assert(!posts[2].components, "a draft is one plain message without buttons");
  assert(posts[2].content.includes("Draft, not sent"));
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
    // Drafts no longer carry buttons; this exercises the retained handler for drafts posted earlier.
    data: { custom_id: `agent:approve:${drafted.messageId}`, component_type: 2 },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.from(timestamp + interaction), privateKey).toString("hex");
  await curl("/v1/discord/interactions", {
    method: "POST",
    body: interaction,
    headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp },
  });
  // Approving hands the draft back to the agent: an operator note with the approve line is
  // echoed, the draft goes stale, and nothing reaches the customer from RespondKit.
  for (let attempt = 0; attempt < 100 && posts.length < 4; attempt++) await delay(100);
  assert.equal(Number(posts.length), 4);
  assert.match(posts[3].content, /`approve:\{"draft":"msg_agent_/);
  assert(posts[3].content.includes("You can export as text or subtitles."));
  const after = await curl(`/v1/threads/${threadId}/messages`, { headers: customerHeaders });
  assert(!JSON.stringify(after).includes("You can export as text or subtitles."));
  await curl("/v1/discord/interactions", {
    method: "POST",
    body: interaction,
    headers: { "x-signature-ed25519": signature, "x-signature-timestamp": timestamp },
  });
  assert.equal(Number(posts.length), 4);
  assert.equal(
    (await sql(`SELECT status FROM agent_reply WHERE message_id='${drafted.messageId}'`))[0].status,
    "stale",
  );
  const unanswered = await agent("/threads?needsReply=1&state=open");
  assert.equal(unanswered.threads.length, 0);
  const noteBody = {
    kind: "reasoning",
    text: "PRIVATE: inspect export settings before proposing a reply.",
    idempotencyKey: "of19-reasoning",
  };
  const note = await agent(`/threads/${threadId}/notes`, noteBody);
  assert.equal(note.delivery, "posted");
  const noteReplay = await agent(`/threads/${threadId}/notes`, noteBody);
  assert.equal(noteReplay.note.id, note.note.id);
  assert.equal(Number(posts.length), 5);
  await curl(`/v1/agent/threads/${threadId}/notes`, {
    method: "POST",
    headers: agentHeaders,
    body: { ...noteBody, text: "Changed" },
    expectedStatus: 409,
  });
  const wake = await agent("/threads?needsAgent=1");
  assert.equal(wake.threads.length, 1);
  assert(wake.threads[0].lastCustomerAt);
  assert(wake.threads[0].lastAgentAt);
  assert(wake.threads[0].lastOperatorAt, "the approval note wakes the agent");
  const timeline = await agent(`/threads/${threadId}`);
  assert.equal(timeline.notes.length, 2);
  assert.match(timeline.notes[0].text, /^Approved \[this draft\]/);
  assert.equal(timeline.notes[1].id, note.note.id);
  const page1 = await agent(`/threads/${threadId}?limit=2`);
  const page2 = await agent(`/threads/${threadId}?limit=2&cursor=${page1.nextCursor}`);
  assert.equal(page1.messages.length, 2);
  assert.equal(page2.notes.length, 2);
  assert.equal(page2.messages.length, 0);
  await agent(`/threads/${threadId}/ack`, { through: timeline.through });
  assert.equal((await agent("/threads?needsAgent=1")).threads.length, 0);
  const customerAfterNote = await curl(`/v1/threads/${threadId}/messages`, {
    headers: customerHeaders,
  });
  assert.deepEqual(customerAfterNote, after);
  const rejectedSteer = await signedCommand(
    { type: 1, name: "agent", options: [{ type: 3, name: "message", value: "Do not store this" }] },
    { member: { user: { id: "999999999999999999" }, roles: [] }, label: "unauthorized /agent" },
  );
  assert.match(rejectedSteer.data.content, /not authorized/);
  const steerId = String((BigInt(Date.now()) - 1420070400000n) << 22n);
  const steerData = {
    type: 1,
    name: "agent",
    options: [
      { type: 3, name: "message", value: "PRIVATE: ask which export format the customer needs." },
    ],
  };
  assert.match((await signedCommand(steerData, { id: steerId })).data.content, /saved and posted/);
  assert.match((await signedCommand(steerData, { id: steerId })).data.content, /saved and posted/);
  assert.equal(Number(posts.length), 6);
  const steered = await agent("/threads?needsAgent=1");
  assert(steered.threads[0].lastOperatorAt);
  assert.equal(steered.threads[0].acknowledgedCursor, timeline.through);
  await agent(`/threads/${threadId}/ack`, { through: timeline.through });
  assert.equal((await agent("/threads?needsAgent=1")).threads.length, 1);
  const steeredRead = await agent(`/threads/${threadId}`);
  assert.equal(steeredRead.notes.at(-1).operatorDiscordUserId, ids.operator);
  await agent(`/threads/${threadId}/ack`, { through: steeredRead.through });
  assert.equal((await agent("/threads?needsAgent=1")).threads.length, 0);
  {
    const longBody = {
      text: "English Approve draft. ".repeat(130),
      mode: "draft",
      idempotencyKey: "of19-Approve draft",
    };
    const longDraft = await agent(`/threads/${threadId}/replies`, longBody);
    const chunks = await waitFor(async () => {
      const rows = await sql(
        `SELECT discord_message_id FROM agent_draft_chunk WHERE message_id='${longDraft.messageId}' ORDER BY chunk_index`,
      );
      return rows.length >= 2 ? rows : null;
    }, "draft chunks persisted");
    const firstChunk = posts.find((post) => post.id === chunks[0].discord_message_id);
    assert(!firstChunk.components);
    assert.match(
      (
        await signedCommand({
          type: 3,
          name: "Approve draft",
          target_id: chunks[0].discord_message_id,
        })
      ).data.content,
      /^Handed to the agent: it will translate this reply into the customer's language/,
    );
    assert.equal(
      (await agent(`/threads/${threadId}/replies`, longBody, null)).status,
      "stale",
      "a handed-back draft can no longer be published as it was",
    );
    assert.match(
      (
        await signedCommand({
          type: 3,
          name: "Approve draft",
          target_id: chunks[1].discord_message_id,
        })
      ).data.content,
      /already handed this draft to the agent/,
    );
  }
  await signedCommand({
    type: 1,
    name: "reply",
    options: [
      { type: 3, name: "message", value: "Human follow-up through the existing reply command." },
    ],
  });
  await waitFor(
    async () => (await agent("/threads?needsAgent=1", undefined, null)).threads.length === 1,
    "human reply wakes agent",
  );
  const humanWake = await agent("/threads?needsAgent=1");
  assert(humanWake.threads[0].lastOperatorAt);
  const customerFinal = await curl(`/v1/threads/${threadId}/messages`, {
    headers: customerHeaders,
  });
  assert(!JSON.stringify(customerFinal).includes("PRIVATE:"));
  const flowStored = await sql(
    `SELECT id,ordering_key,author_kind,kind,operator_discord_user_id,discord_message_ids FROM internal_note WHERE thread_id='${threadId}' ORDER BY ordering_key; SELECT through_sequence FROM agent_ack WHERE thread_id='${threadId}'; SELECT sequence,message_id,note_id,author_kind FROM agent_timeline WHERE thread_id='${threadId}' ORDER BY sequence;`,
  );
  await sql(`UPDATE thread SET customer_language='fr' WHERE id='${threadId}'`);
  const previewStart = posts.length;
  const translationStart = translationRequests.length;
  const translatedDraftBody = {
    text: "The English export answer for joint approval.",
    idempotencyKey: "of19-joint-approval",
    translate: "customer",
    mode: "draft",
  };
  const translatedDraft = await agent(`/threads/${threadId}/replies`, translatedDraftBody);
  const preview = await waitFor(
    async () =>
      (
        await sql(
          `SELECT p.result_json,p.confirmed_by,p.posted_at,c.discord_message_id FROM agent_draft_preview p JOIN agent_draft_chunk c ON c.message_id=p.message_id WHERE p.message_id='${translatedDraft.messageId}' AND p.posted_at IS NOT NULL AND c.chunk_index=0`,
        )
      )[0],
    "translated preview ready",
  );
  assert.equal(preview.confirmed_by, null);
  const previewPost = posts.find((post) => post.id === preview.discord_message_id);
  assert.match(previewPost.content, /The English export answer/);
  assert(previewPost.content.includes(translatedText));
  assert(previewPost.content.includes("Verify the export wording."));
  assert.equal(translationRequests.length - translationStart, 1);
  const previewCustomer = await curl(`/v1/threads/${threadId}/messages`, {
    headers: customerHeaders,
  });
  assert(!JSON.stringify(previewCustomer).includes(translatedDraftBody.text));
  assert(!JSON.stringify(previewCustomer).includes(translatedText));
  // The preview is for reading only: approval hands the English to the agent, in the thread's language.
  assert.match(
    (await signedCommand({ type: 3, name: "Approve draft", target_id: preview.discord_message_id }))
      .data.content,
    /^Handed to the agent: it will translate this reply into French \(fr\), send it, and post both versions here\.$/,
  );
  assert.equal(
    (await agent(`/threads/${threadId}/replies`, translatedDraftBody, null)).status,
    "stale",
  );
  const handedBack = await agent(`/threads/${threadId}`);
  const approvalNote = handedBack.notes.at(-1);
  assert.equal(approvalNote.kind, "steer");
  const approvalLine = approvalNote.text.split("\n")[1];
  const approval = JSON.parse(approvalLine.slice("`approve:".length, -1));
  assert.deepEqual(approval, {
    draft: translatedDraft.messageId,
    language: "fr",
    sha256: createHash("sha256").update(translatedDraftBody.text).digest("hex"),
    by: ids.operator,
  });
  assert.equal(approvalNote.text.split("\n").slice(2).join("\n"), translatedDraftBody.text);
  const previewCustomerAfter = await curl(`/v1/threads/${threadId}/messages`, {
    headers: customerHeaders,
  });
  assert(!JSON.stringify(previewCustomerAfter).includes(translatedDraftBody.text));
  await agent(`/threads/${threadId}/ack`, { through: handedBack.through });
  assert.equal(translationRequests.length - translationStart, 1);
  assert(
    !posts
      .slice(previewStart)
      .some((post) =>
        post.components?.some((row) =>
          row.components.some((button) => button.label === "Approve translation"),
        ),
      ),
  );

  const legacyBody = {
    text: "Legacy English answer.",
    idempotencyKey: "of19-legacy-review",
    translate: "fr",
    mode: "draft",
  };
  const legacyIdentity = createHash("sha256")
    .update(JSON.stringify(["inbox_of10", legacyBody.idempotencyKey]))
    .digest("hex");
  const storedEnvelope = (
    await sql(`SELECT envelope FROM agent_reply WHERE message_id='${sent.messageId}'`)
  )[0].envelope;
  const legacyEnvelope = {
    ...JSON.parse(storedEnvelope),
    messageId: `msg_agent_${legacyIdentity}`,
    workflowInstanceId: `agent_${legacyIdentity}`,
    acceptedAt: new Date().toISOString(),
    originalText: legacyBody.text,
    replyTranslation: "fr",
    replyTranslationRequest: "fr",
    agent: { name: "Local helper", mode: "draft" },
  };
  const literal = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'`;
  await sql(`INSERT INTO agent_reply(message_id,workspace_id,inbox_id,thread_id,idempotency_key,request_json,envelope,mode,status,basis_row_id,created_at)
    SELECT '${legacyEnvelope.messageId}',workspace_id,inbox_id,id,'${legacyBody.idempotencyKey}',${literal({ threadId, ...legacyBody })},${literal(legacyEnvelope)},'draft','pending',coalesce((SELECT max(row_id) FROM message WHERE thread_id=thread.id),0),${Date.now()} FROM thread WHERE id='${threadId}'`);
  await agent(`/threads/${threadId}/replies`, legacyBody);
  await waitFor(
    async () =>
      (
        await sql(
          `SELECT discord_message_id FROM agent_draft_chunk WHERE message_id='${legacyEnvelope.messageId}' AND chunk_index=0`,
        )
      )[0],
    "legacy draft posted",
  );
  // Operators now hand drafts back; the agent's own approval (its untapped-draft timeout) still
  // approves a legacy draft in place, which then needs its translation approved.
  assert.equal(
    (await agent(`/threads/${threadId}/replies/${legacyEnvelope.messageId}/approve`, {})).outcome,
    "approved",
  );
  await waitFor(
    async () =>
      posts.find((post) =>
        post.components?.some((row) =>
          row.components.some(
            (button) => button.custom_id === `agent:translate:${legacyEnvelope.messageId}:1`,
          ),
        ),
      ),
    "legacy translation review posted",
  );
  await signedCommand({
    type: 1,
    name: "agent",
    options: [
      {
        type: 3,
        name: "message",
        value: "PRIVATE: investigate the next issue, keeping the approved answer.",
      },
    ],
  });
  assert.equal(
    (await sql(`SELECT status FROM agent_reply WHERE message_id='${legacyEnvelope.messageId}'`))[0]
      .status,
    "approved",
  );
  const translatedDecision = await signedCommand(
    { custom_id: `agent:translate:${legacyEnvelope.messageId}:1`, component_type: 2 },
    { type: 3, label: "legacy Approve translation after steering" },
  );
  assert.match(translatedDecision.data.content, /approved/);
  await waitFor(
    async () =>
      (await agent(`/threads/${threadId}/replies`, legacyBody, null)).status === "available",
    "legacy approved translation survives steering",
  );
  const followupStored = await sql(
    `SELECT r.message_id,r.status,r.decided_by,v.confirmed_by,m.customer_visible_text FROM agent_reply r JOIN reply_review v ON v.message_id=r.message_id JOIN message m ON m.id=r.message_id WHERE r.message_id IN ('${translatedDraft.messageId}','${legacyEnvelope.messageId}')`,
  );
  await agent(`/threads/${threadId}/close`, {});
  const stored = await sql(
    `SELECT status,claimed_by FROM thread WHERE id='${threadId}'; SELECT id,author_kind,author_name,customer_visible_text,processing_status FROM message WHERE thread_id='${threadId}' ORDER BY row_id; SELECT status,decided_by FROM agent_reply WHERE message_id='${drafted.messageId}';`,
  );
  assert.equal(stored[0].status, "closed");
  assert.equal(stored.at(-1).status, "stale", "the handed-back draft was never published");
  const doc = `# OF-19 follow-up: approved steering and joint translation approval\n\nRun: ${new Date().toISOString()}\n\nExecuted \`node apps/api/scripts/verify-agent-api.mjs\` against \`wrangler dev --local\`, using the real Hono Worker, D1 migrations 0000–0011, and MessageWorkflow. HTTP calls below were made with curl. Loopback Discord and Gemini REST fixtures captured requests. An ignored local Worker entrypoint redirects Gemini fetches to the fixture and rejects all other external fetches; the production workflow and translation adapter are unchanged by the harness. The fixture always returns needsReview=true; Ed25519 keys and agent/session credentials were generated for this run and are redacted. The ready Discord mapping was seeded locally. No remote database, Discord channel, email provider, Gemini service, or deployed Worker was touched.\n\n## Curl transcript\n\n${evidence.map((entry) => `### ${entry.request}\n\nHTTP ${entry.status}\n\n\`\`\`json\n${JSON.stringify(entry.data, null, 2)}\n\`\`\`\n`).join("\n")}\n## Discord posts captured\n\n\`\`\`json\n${JSON.stringify(posts, null, 2)}\n\`\`\`\n\n## D1 readback\n\n\`\`\`json\n${JSON.stringify({ messagesAndDrafts: stored, threadFlow: flowStored, approvedTranslations: followupStored, translationProviderCalls: translationRequests.length }, null, 2)}\n\`\`\`\n\nAssertions passed: English and uncertain translation preview displayed before approval; Approve draft, /approve and old Approve buttons hand the draft back to the agent as an operator note with the approve line (draft, language, English hash, operator) and the English text, stale the draft and publish nothing; repeated approval answers that the draft was already handed back; one provider call for the preview; legacy agent-approved translation survives steering and completes after its existing translation approval; notes stored and posted; immutable note replay/conflict; shared message/note pagination; customer payload unchanged by notes; needsAgent and monotonic ack; signed allowlisted steering with identity and duplicate interaction; context Approve on non-button draft chunks; existing human /reply wakes agent; customer-created thread; unanswered listing; full read; claim; send; same-key replay; operator-only draft; signed allowlisted hand-back; nothing customer-visible from an approval; duplicate approval without a second note; unanswered list empty; close persisted.\n`;
  await mkdir(resolve(root, "docs/verification"), { recursive: true });
  await writeFile(resolve(root, "docs/verification/of-19-followup.md"), doc);
  console.log(
    `OF-19 follow-up local walkthrough passed (${evidence.length} curl calls, ${posts.length} Discord posts).`,
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
