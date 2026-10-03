import { deriveCustomerMessageIdentity } from "@respondkit/protocol";
import { emailConfigurationSchema } from "@respondkit/workspaces";
import PostalMime from "postal-mime";
import { z } from "zod";
import type { Env } from "./env";
import { acceptWorkflow } from "./workflow-binding";
import { customerWorkflowEnvelopeSchema, type MessageWorkflowEnvelope } from "./workflows/envelope";

async function settings(env: Env, inboxId: string) {
  const row = await env.DB.prepare(
    "SELECT email_config FROM inbox WHERE id = ? AND status = 'active'",
  )
    .bind(inboxId)
    .first<{ email_config: string | null }>();
  return row?.email_config
    ? emailConfigurationSchema.parse(JSON.parse(row.email_config))
    : undefined;
}

/** Snapshot a published reply. Retrying enqueue never moves its original deadline. */
export async function enqueueReplyEmail(env: Env, messageId: string): Promise<void> {
  const row = await env.DB.prepare(`SELECT m.thread_id, m.inbox_id, m.customer_visible_text AS body,
    v.email, e.row_id AS cursor, e.event_at, t.customer_read_cursor FROM message m
    JOIN thread t ON t.id=m.thread_id JOIN visitor v ON v.id=t.visitor_id
    JOIN customer_transcript_entry e ON e.message_id=m.id AND e.event_kind='available'
      AND e.processing_generation=m.processing_generation
    WHERE m.id=? AND m.direction='operator_to_customer' AND m.customer_availability='available'`)
    .bind(messageId)
    .first<{
      thread_id: string;
      inbox_id: string;
      body: string;
      email: string | null;
      cursor: number;
      event_at: number;
      customer_read_cursor: number;
    }>();
  if (!row?.email) return;
  const config = await settings(env, row.inbox_id);
  if (!config) return;
  const recipient = z.email().parse(row.email).toLowerCase();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO thread_email_route (token, thread_id, recipient) VALUES (?, ?, ?)",
  )
    .bind(crypto.randomUUID().replaceAll("-", ""), row.thread_id, recipient)
    .run();
  const route = await env.DB.prepare(
    "SELECT token FROM thread_email_route WHERE thread_id=? AND recipient=?",
  )
    .bind(row.thread_id, recipient)
    .first<{ token: string }>();
  if (!route) throw new Error("Email route missing");
  await env.DB.prepare(`INSERT OR IGNORE INTO email_delivery
    (message_id,route_token,sender,reply_to,subject,body,updated_at,due_at,transcript_cursor,status)
    SELECT ?,?,?,?,?,?,?,?,?, CASE WHEN customer_read_cursor >= ? THEN 'cancelled' ELSE 'pending' END
    FROM thread WHERE id=?`)
    .bind(
      messageId,
      route.token,
      config.from,
      `reply+${route.token}@${config.replyDomain}`,
      `${config.name} · Support ${row.thread_id.slice(-8)}`,
      row.body,
      Date.now(),
      row.event_at + config.unreadDelaySeconds * 1000,
      row.cursor,
      row.cursor,
      row.thread_id,
    )
    .run();
}

/** An ambiguous provider acceptance is held for reconciliation rather than automatically duplicated. */
export async function deliverPendingEmails(env: Env): Promise<void> {
  if (!env.EMAIL) return;
  await env.DB.prepare(
    "UPDATE email_delivery SET status='unknown' WHERE status='sending' AND updated_at < ?",
  )
    .bind(Date.now() - 600_000)
    .run();
  const groups =
    await env.DB.prepare(`SELECT d.route_token,d.sender,d.reply_to,d.subject,r.recipient,t.inbox_id
    FROM email_delivery d JOIN thread_email_route r ON r.token=d.route_token JOIN thread t ON t.id=r.thread_id
    JOIN inbox i ON i.id=t.inbox_id
    WHERE d.status='pending' AND d.due_at<=? AND i.email_config IS NOT NULL AND i.status='active'
    GROUP BY d.route_token,d.sender,d.reply_to,d.subject ORDER BY min(d.due_at) LIMIT 25`)
      .bind(Date.now())
      .all<{
        route_token: string;
        sender: string;
        reply_to: string;
        subject: string;
        recipient: string;
        inbox_id: string;
      }>();
  for (const mail of groups.results) {
    const config = await settings(env, mail.inbox_id);
    if (!config) continue;
    const batch = crypto.randomUUID();
    await env.DB.prepare(`UPDATE email_delivery SET status='sending',batch_id=?,updated_at=?
      WHERE status='pending' AND route_token=? AND sender=? AND reply_to=? AND subject=? AND due_at<=?`)
      .bind(
        batch,
        Date.now(),
        mail.route_token,
        mail.sender,
        mail.reply_to,
        mail.subject,
        Date.now(),
      )
      .run();
    // Fresh, uncached read immediately before handing the remaining messages to the provider.
    // Also suppress mail to a stale contact address when the customer has changed it.
    await env.DB.prepare(`UPDATE email_delivery SET status='cancelled',updated_at=? WHERE batch_id=?
      AND EXISTS (SELECT 1 FROM thread_email_route r JOIN thread t ON t.id=r.thread_id
        JOIN visitor v ON v.id=t.visitor_id JOIN message m ON m.id=email_delivery.message_id
        WHERE r.token=email_delivery.route_token AND (t.customer_read_cursor>=email_delivery.transcript_cursor
          OR lower(coalesce(v.email,''))<>r.recipient OR m.customer_availability<>'available'))`)
      .bind(Date.now(), batch)
      .run();
    const remaining = await env.DB.prepare(
      "SELECT body FROM email_delivery WHERE batch_id=? AND status='sending' ORDER BY transcript_cursor",
    )
      .bind(batch)
      .all<{ body: string }>();
    if (!remaining.results.length) continue;
    try {
      const sent = await env.EMAIL.send({
        from: mail.sender,
        to: mail.recipient,
        replyTo: mail.reply_to,
        subject: mail.subject,
        text: remaining.results.map((row) => row.body).join("\n\n—\n\n"),
        headers: { "Auto-Submitted": "auto-generated" },
      });
      await env.DB.prepare(
        "UPDATE email_delivery SET status='sent',provider_id=?,updated_at=? WHERE batch_id=? AND status='sending'",
      )
        .bind(sent.messageId, Date.now(), batch)
        .run();
    } catch {
      await env.DB.prepare(
        "UPDATE email_delivery SET status='unknown',updated_at=? WHERE batch_id=? AND status='sending'",
      )
        .bind(Date.now(), batch)
        .run();
    }
  }
}

export type IncomingEmail = Pick<
  ForwardableEmailMessage,
  "from" | "to" | "headers" | "raw" | "rawSize" | "setReject"
>;

export async function receiveThreadEmail(message: IncomingEmail, env: Env): Promise<void> {
  const reject = (reason: string) => message.setReject(reason);
  const address = /^reply\+([a-f0-9]{32})@(.+)$/i.exec(message.to);
  if (!address || message.rawSize > 256_000) return reject("Unsupported support email");
  const route =
    await env.DB.prepare(`SELECT r.recipient, t.id AS thread_id, t.workspace_id, t.inbox_id,
    t.visitor_id, t.status FROM thread_email_route r JOIN thread t ON t.id = r.thread_id WHERE r.token = ?`)
      .bind(address[1])
      .first<{
        recipient: string;
        thread_id: string;
        workspace_id: string;
        inbox_id: string;
        visitor_id: string;
        status: string;
      }>();
  const config = route ? await settings(env, route.inbox_id) : undefined;
  if (
    !route ||
    !config ||
    config.replyDomain !== address[2]?.toLowerCase() ||
    route.recipient !== message.from.toLowerCase()
  ) {
    return reject("Unknown support reply address or sender");
  }
  if (route.status !== "open")
    return reject("This support conversation is closed. Start a new conversation in the app.");
  const automated = message.headers.get("auto-submitted");
  if (
    (automated && automated.toLowerCase() !== "no") ||
    /^(bulk|list|junk)$/i.test(message.headers.get("precedence") ?? "")
  ) {
    return reject("Automated replies are not accepted");
  }
  const parsed = await PostalMime.parse(message.raw);
  if (parsed.from?.address?.toLowerCase() !== route.recipient)
    return reject("Sender does not match this conversation");
  // Never silently discard attachments or truncate a customer's request.
  if (parsed.attachments.length > 0)
    return reject("Attachments are not supported. Please send a text reply.");
  const body = parsed.text?.trim();
  if (!body || body.length > 6_000) return reject("Send a plain-text reply of 1–6000 characters");
  const sourceId = parsed.messageId;
  if (!sourceId || sourceId.length > 998) return reject("A valid Message-ID is required");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify([address[1], sourceId])),
  );
  const clientMessageId = `email_${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const identity = await deriveCustomerMessageIdentity({
    workspaceId: route.workspace_id,
    threadId: route.thread_id,
    clientMessageId,
  });
  const envelope: MessageWorkflowEnvelope = {
    schema: "respondkit.workflow-message/1",
    direction: "customer_to_operator",
    workspaceId: route.workspace_id,
    inboxId: route.inbox_id,
    threadId: route.thread_id,
    visitorId: route.visitor_id,
    ...identity,
    clientMessageId,
    originalText: body,
    acceptedAt: new Date().toISOString(),
    context: { email: route.recipient },
  };
  await env.DB.prepare("INSERT OR IGNORE INTO email_ingress (id, envelope) VALUES (?, ?)")
    .bind(identity.messageId, JSON.stringify(envelope))
    .run();
  const stored = await env.DB.prepare("SELECT envelope FROM email_ingress WHERE id = ?")
    .bind(identity.messageId)
    .first<{ envelope: string }>();
  if (!stored) throw new Error("Email ingress missing");
  const canonical = customerWorkflowEnvelopeSchema.parse(JSON.parse(stored.envelope));
  const accepted = await acceptWorkflow(
    env.MESSAGE_WORKFLOW,
    identity.workflowInstanceId,
    canonical,
  );
  if (accepted.kind === "unknown")
    throw new Error("Email workflow acceptance unknown; retry delivery");
}
