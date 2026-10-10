import {
  closeThread,
  findThreadById,
  messages,
  messageTranslations,
  reopenThread,
  threads,
  translationJobs,
} from "@respondkit/conversations";
import {
  discordIntegrations,
  discordThreads,
  normalizeTranslationLanguage,
} from "@respondkit/discord";
import {
  findInboxByPublicId,
  findVisitorCustomer,
  visitors,
  type InboxContext,
} from "@respondkit/workspaces";
import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { activityConnection, ActivityError, fetchActivity } from "./activity-service";
import { createDatabase } from "./db";
import type { Env } from "./env";
import { readBearerToken } from "./session";
import { translationEnabled } from "./translation-service";
import { acceptWorkflow } from "./workflow-binding";
import { agentOperatorEnvelopeSchema } from "./workflows/envelope";

export async function agentTokenHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

interface AgentAuth {
  inbox: InboxContext;
  name: string;
  holder: string;
}

async function authenticate(
  env: Env,
  authorization: string | undefined,
  runId: string | undefined,
): Promise<AgentAuth> {
  const token = readBearerToken(authorization);
  if (!token || token.length > 1024)
    throw new HTTPException(401, { message: "A valid agent bearer token is required" });
  const hash = await agentTokenHash(token);
  const bytes = (value: string) =>
    Uint8Array.from(value.match(/../g)!, (pair) => parseInt(pair, 16));
  const supplied = bytes(hash);
  let inboxId: string | undefined;
  let matches = 0;
  for (const [key, value] of Object.entries(env)) {
    if (
      !key.startsWith("AGENT_TOKEN_") ||
      typeof value !== "string" ||
      !/^[a-f0-9]{64}$/.test(value)
    )
      continue;
    if (
      (
        crypto.subtle as SubtleCrypto & { timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean }
      ).timingSafeEqual(supplied, bytes(value))
    ) {
      inboxId = key.slice("AGENT_TOKEN_".length);
      matches++;
    }
  }
  if (matches !== 1 || !inboxId)
    throw new HTTPException(401, { message: "The agent credential is invalid" });
  const inbox = await findInboxByPublicId(createDatabase(env.DB), inboxId);
  if (!inbox) throw new HTTPException(401, { message: "The agent inbox is unavailable" });
  const window = Math.floor(Date.now() / 60_000);
  const rate =
    await env.DB.prepare(`INSERT INTO agent_rate_limit(token_hash,window,count) VALUES (?,?,1)
    ON CONFLICT(token_hash) DO UPDATE SET window=excluded.window,
    count=CASE WHEN agent_rate_limit.window=excluded.window THEN agent_rate_limit.count+1 ELSE 1 END RETURNING count`)
      .bind(hash, window)
      .first<{ count: number }>();
  if (!rate || rate.count > 120)
    throw new HTTPException(429, { message: "Agent rate limit exceeded; retry next minute" });
  const run = z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(runId ?? "default");
  const name = z
    .string()
    .regex(/^[\p{L}\p{N} ._-]{1,80}$/u)
    .parse(env[`AGENT_NAME_${inboxId}`] || inboxId);
  return { inbox, name, holder: `agent_${(await agentTokenHash(`${hash}:${run}`)).slice(0, 32)}` };
}

const threadQuerySchema = z.object({
  state: z.enum(["open", "closed"]).optional(),
  needsReply: z.enum(["0", "1"]).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const replySchema = z
  .object({
    text: z
      .string()
      .min(1)
      .max(6000)
      .refine((text) => text.trim().length > 0),
    idempotencyKey: z.string().min(1).max(128),
    translate: z.string().min(2).max(35).default("off"),
    mode: z.enum(["send", "draft"]),
  })
  .strict();

async function requestJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 32_000) throw new HTTPException(400, { message: "Request is too large" });
  try {
    return JSON.parse(text);
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON" });
  }
}

export function createAgentApp() {
  const app = new Hono<{ Bindings: Env; Variables: { agent: AgentAuth } }>();
  app.use("*", async (c, next) => {
    c.header("cache-control", "no-store");
    c.set(
      "agent",
      await authenticate(c.env, c.req.header("authorization"), c.req.header("x-agent-run-id")),
    );
    await next();
  });
  app.get("/threads", async (c) => {
    const { inbox } = c.get("agent");
    const query = threadQuerySchema.parse(c.req.query());
    let cursor: { at: number; id: string } | undefined;
    if (query.cursor) {
      try {
        cursor = z
          .object({ at: z.number().int().nonnegative(), id: z.string().min(1).max(128) })
          .parse(JSON.parse(atob(query.cursor)));
      } catch {
        throw new HTTPException(400, { message: "Invalid thread cursor" });
      }
    }
    const db = createDatabase(c.env.DB);
    const rows = await db
      .select({
        thread: threads,
        visitor: visitors,
        discordThreadId: discordThreads.discordThreadId,
        guildId: discordIntegrations.guildId,
      })
      .from(threads)
      .innerJoin(
        visitors,
        and(
          eq(visitors.id, threads.visitorId),
          eq(visitors.inboxId, threads.inboxId),
          eq(visitors.workspaceId, threads.workspaceId),
        ),
      )
      .leftJoin(discordThreads, eq(discordThreads.threadId, threads.id))
      .leftJoin(discordIntegrations, eq(discordIntegrations.id, discordThreads.integrationId))
      .where(
        and(
          eq(threads.workspaceId, inbox.workspaceId),
          eq(threads.inboxId, inbox.inboxId),
          query.state ? eq(threads.status, query.state) : undefined,
          query.needsReply === "1"
            ? sql`(SELECT direction FROM message WHERE thread_id=${threads.id}
          AND (direction='customer_to_operator' OR customer_availability='available')
          ORDER BY accepted_at DESC,id DESC LIMIT 1)='customer_to_operator'`
            : undefined,
          cursor
            ? or(
                lt(threads.lastActivityAt, new Date(cursor.at)),
                and(eq(threads.lastActivityAt, new Date(cursor.at)), lt(threads.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(threads.lastActivityAt), desc(threads.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1)?.thread;
    return c.json({
      threads: page.map((row) => ({
        ...row.thread,
        state: row.thread.status,
        visitor: row.visitor,
        discordThreadUrl:
          row.guildId && row.discordThreadId
            ? `https://discord.com/channels/${row.guildId}/${row.discordThreadId}`
            : null,
      })),
      nextCursor:
        rows.length > query.limit && last
          ? btoa(JSON.stringify({ at: last.lastActivityAt.getTime(), id: last.id }))
          : null,
    });
  });
  app.use("/threads/:id/*", async (c, next) => {
    const { inbox } = c.get("agent");
    const thread = await findThreadById(createDatabase(c.env.DB), {
      ...inbox,
      threadId: c.req.param("id")!,
    });
    if (!thread) throw new HTTPException(404, { message: "Thread not found" });
    await next();
  });
  app.get("/threads/:id", async (c) => {
    const { inbox } = c.get("agent");
    const db = createDatabase(c.env.DB);
    const thread = await findThreadById(db, { ...inbox, threadId: c.req.param("id") });
    if (!thread) throw new HTTPException(404, { message: "Thread not found" });
    const query = z
      .object({
        cursor: z.coerce.number().int().nonnegative().default(0),
        limit: z.coerce.number().int().min(1).max(100).default(100),
      })
      .parse(c.req.query());
    const [visitor] = await db.select().from(visitors).where(eq(visitors.id, thread.visitorId));
    const identity = await findVisitorCustomer(db, thread.visitorId);
    const transcript = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.threadId, thread.id),
          eq(messages.inboxId, inbox.inboxId),
          gt(messages.rowId, query.cursor),
        ),
      )
      .orderBy(asc(messages.rowId))
      .limit(query.limit + 1);
    const page = transcript.slice(0, query.limit);
    const translations = await db
      .select()
      .from(messageTranslations)
      .where(
        and(
          eq(messageTranslations.threadId, thread.id),
          eq(messageTranslations.inboxId, inbox.inboxId),
          sql`${messageTranslations.messageId} IN (SELECT id FROM message WHERE thread_id=${thread.id} AND row_id>${query.cursor} ORDER BY row_id LIMIT ${query.limit})`,
        ),
      );
    const jobs = await db
      .select()
      .from(translationJobs)
      .where(
        and(
          eq(translationJobs.threadId, thread.id),
          eq(translationJobs.status, "succeeded"),
          sql`${translationJobs.messageId} IN (SELECT id FROM message WHERE thread_id=${thread.id} AND row_id>${query.cursor} ORDER BY row_id LIMIT ${query.limit})`,
        ),
      );
    let activity: unknown = null;
    const configured = JSON.parse(c.env.POSTHOG_ACTIVITY_INBOXES ?? "{}");
    if (Object.hasOwn(configured, inbox.inboxId)) {
      try {
        const apiKey = c.env[`POSTHOG_API_KEY_${inbox.inboxId}`];
        if (!apiKey || !visitor?.posthogDistinctId)
          throw new ActivityError("PostHog key or customer distinct ID is missing");
        activity = await fetchActivity({
          connection: activityConnection(c.env, inbox.inboxId),
          apiKey,
          distinctId: visitor.posthogDistinctId,
          options: { count: 20, minutes: 10080, activityKind: "all" },
          end: Date.now(),
        });
      } catch (error) {
        if (!(error instanceof ActivityError)) throw error;
        activity = { error: error.message };
      }
    }
    const mapping = await c.env.DB.prepare(
      "SELECT dt.discord_thread_id,di.guild_id FROM discord_thread dt JOIN discord_integration di ON di.id=dt.integration_id WHERE dt.thread_id=? AND dt.state='ready'",
    )
      .bind(thread.id)
      .first<{ discord_thread_id: string; guild_id: string }>();
    return c.json({
      thread: { ...thread, state: thread.status },
      visitor,
      verifiedUserId: identity?.userId ?? null,
      discordThreadUrl: mapping
        ? `https://discord.com/channels/${mapping.guild_id}/${mapping.discord_thread_id}`
        : null,
      messages: page.map((message) => ({
        ...message,
        translations: translations.filter((t) => t.messageId === message.id),
        onDemandTranslations: jobs
          .filter((job) => job.messageId === message.id)
          .map((job) => JSON.parse(job.resultJson!)),
      })),
      nextCursor: transcript.length > query.limit ? page.at(-1)!.rowId.toString() : null,
      activity,
    });
  });
  app.post("/threads/:id/claim", async (c) => {
    const { inbox, holder } = c.get("agent");
    const { leaseSeconds } = z
      .object({ leaseSeconds: z.number().int().min(1).max(3600) })
      .strict()
      .parse(await requestJson(c.req.raw));
    const now = Date.now();
    const claimed =
      await c.env.DB.prepare(`UPDATE thread SET claimed_by=?,claim_expires_at=? WHERE id=? AND inbox_id=? AND workspace_id=? AND status='open'
      AND (claimed_by IS NULL OR claim_expires_at<=? OR claimed_by=?) RETURNING claimed_by,claim_expires_at`)
        .bind(
          holder,
          now + leaseSeconds * 1000,
          c.req.param("id"),
          inbox.inboxId,
          inbox.workspaceId,
          now,
          holder,
        )
        .first<{ claimed_by: string; claim_expires_at: number }>();
    if (!claimed)
      throw new HTTPException(409, { message: "Thread is closed or has another live claim" });
    return c.json({
      claimedBy: claimed.claimed_by,
      claimExpiresAt: new Date(claimed.claim_expires_at).toISOString(),
    });
  });
  app.post("/threads/:id/release", async (c) => {
    const { inbox, holder } = c.get("agent");
    const released =
      await c.env.DB.prepare(`UPDATE thread SET claimed_by=NULL,claim_expires_at=NULL WHERE id=? AND inbox_id=?
      AND (claimed_by IS NULL OR claimed_by=? OR claim_expires_at<=?) RETURNING id`)
        .bind(c.req.param("id"), inbox.inboxId, holder, Date.now())
        .first();
    if (!released) throw new HTTPException(409, { message: "Another holder has a live claim" });
    return c.json({ released: true });
  });
  app.post("/threads/:id/replies", async (c) => {
    const auth = c.get("agent");
    const request = replySchema.parse(await requestJson(c.req.raw));
    const threadId = c.req.param("id");
    const canonicalRequest = JSON.stringify({ threadId, ...request });
    const db = createDatabase(c.env.DB);
    let stored = await c.env.DB.prepare(
      "SELECT envelope,request_json,status FROM agent_reply WHERE inbox_id=? AND idempotency_key=?",
    )
      .bind(auth.inbox.inboxId, request.idempotencyKey)
      .first<{ envelope: string; request_json: string; status: string }>();
    if (!stored) {
      const thread = (await findThreadById(db, { ...auth.inbox, threadId }))!;
      let translate = request.translate;
      if (translate !== "off") {
        if (!translationEnabled(c.env, auth.inbox.inboxId))
          throw new HTTPException(409, { message: "Translation is not enabled for this inbox" });
        if (translate === "customer") {
          if (!thread.customerLanguage)
            throw new HTTPException(409, {
              message: "Customer language is unknown; specify a language code",
            });
          translate = thread.customerLanguage;
        } else {
          try {
            translate = normalizeTranslationLanguage(translate);
          } catch {
            throw new HTTPException(400, { message: "Invalid translation language" });
          }
        }
      }
      const identity = await agentTokenHash(
        JSON.stringify([auth.inbox.inboxId, request.idempotencyKey]),
      );
      const envelope = agentOperatorEnvelopeSchema.parse({
        schema: "respondkit.workflow-message/1",
        source: "agent",
        direction: "operator_to_customer",
        workspaceId: auth.inbox.workspaceId,
        inboxId: auth.inbox.inboxId,
        threadId,
        visitorId: thread.visitorId,
        messageId: `msg_agent_${identity}`,
        workflowInstanceId: `agent_${identity}`,
        acceptedAt: new Date().toISOString(),
        originalText: request.text,
        replyTranslation: translate,
        replyTranslationRequest: request.translate,
        agent: { name: auth.name, mode: request.mode },
      });
      await c.env.DB.prepare(`INSERT INTO agent_reply(message_id,workspace_id,inbox_id,thread_id,idempotency_key,request_json,envelope,mode,status,basis_row_id,created_at)
        SELECT ?,workspace_id,inbox_id,id,?,?,?,?,?,coalesce((SELECT max(row_id) FROM message WHERE thread_id=thread.id),0),?
        FROM thread WHERE id=? AND inbox_id=? AND status='open' AND (claimed_by IS NULL OR claim_expires_at<=? OR claimed_by=?)
        ON CONFLICT(inbox_id,idempotency_key) DO NOTHING`)
        .bind(
          envelope.messageId,
          request.idempotencyKey,
          canonicalRequest,
          JSON.stringify(envelope),
          request.mode,
          request.mode === "draft" ? "pending" : "approved",
          Date.now(),
          threadId,
          auth.inbox.inboxId,
          Date.now(),
          auth.holder,
        )
        .run();
      stored = await c.env.DB.prepare(
        "SELECT envelope,request_json,status FROM agent_reply WHERE inbox_id=? AND idempotency_key=?",
      )
        .bind(auth.inbox.inboxId, request.idempotencyKey)
        .first();
      if (!stored)
        throw new HTTPException(409, { message: "Thread is closed or has another live claim" });
    }
    if (stored.request_json !== canonicalRequest)
      throw new HTTPException(409, {
        message: "Idempotency key belongs to another immutable reply",
      });
    const envelope = agentOperatorEnvelopeSchema.parse(JSON.parse(stored.envelope));
    if (stored.status === "rejected" || stored.status === "stale")
      return c.json({ messageId: envelope.messageId, status: stored.status });
    const acceptance = await acceptWorkflow(
      c.env.MESSAGE_WORKFLOW,
      envelope.workflowInstanceId,
      envelope,
    );
    const message = await db
      .select()
      .from(messages)
      .where(eq(messages.id, envelope.messageId))
      .get();
    return c.json(
      {
        messageId: envelope.messageId,
        mode: envelope.agent.mode,
        status: message?.customerAvailability === "available" ? "available" : stored.status,
        acceptance: acceptance.kind === "unknown" ? "acceptance_unknown" : acceptance.kind,
        workflowStatus: acceptance.kind === "existing" ? acceptance.status.status : null,
        processingStatus: message?.processingStatus ?? null,
        failureCode: message?.failureCode ?? null,
      },
      acceptance.kind === "unknown" ? 503 : 202,
    );
  });
  for (const action of ["close", "reopen"] as const) {
    app.post(`/threads/:id/${action}`, async (c) => {
      const { inbox, holder } = c.get("agent");
      const threadId = c.req.param("id")!;
      const db = createDatabase(c.env.DB);
      const thread =
        action === "close"
          ? await closeThread(db, { ...inbox, threadId, closedAt: new Date(), claimedBy: holder })
          : await reopenThread(db, {
              ...inbox,
              threadId,
              reopenedAt: new Date(),
              claimedBy: holder,
            });
      if (!thread) throw new HTTPException(409, { message: "Another holder has a live claim" });
      return c.json({ thread });
    });
  }
  return app;
}
