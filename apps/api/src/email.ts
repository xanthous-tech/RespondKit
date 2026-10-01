import { deriveCustomerMessageIdentity } from "@respondkit/protocol";
import PostalMime from "postal-mime";
import { z } from "zod";
import type { Env } from "./env";
import { acceptWorkflow } from "./workflow-binding";
import { customerWorkflowEnvelopeSchema, type MessageWorkflowEnvelope } from "./workflows/envelope";

const settingsSchema = z.record(
  z.string(),
  z.object({
    from: z.email(),
    replyDomain: z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
    name: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[^\r\n]+$/),
  }),
);

function settings(env: Env) {
  return settingsSchema.parse(JSON.parse(env.EMAIL_INBOXES ?? "{}"));
}

/** Persist the exact recipient and customer-visible text before any external send. */
export async function enqueueReplyEmail(env: Env, messageId: string): Promise<void> {
  if (!env.EMAIL_INBOXES) return;
  const row = await env.DB.prepare(`SELECT m.thread_id, m.inbox_id, m.customer_visible_text AS body,
    v.email FROM message m JOIN thread t ON t.id = m.thread_id JOIN visitor v ON v.id = t.visitor_id
    WHERE m.id = ? AND m.direction = 'operator_to_customer' AND m.customer_availability = 'available'`)
    .bind(messageId)
    .first<{ thread_id: string; inbox_id: string; body: string; email: string | null }>();
  if (!row?.email) return;
  const config = settings(env)[row.inbox_id];
  if (!config) return;
  const recipient = z.email().parse(row.email).toLowerCase();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO thread_email_route (token, thread_id, recipient) VALUES (?, ?, ?)",
  )
    .bind(crypto.randomUUID().replaceAll("-", ""), row.thread_id, recipient)
    .run();
  const route = await env.DB.prepare(
    "SELECT token FROM thread_email_route WHERE thread_id = ? AND recipient = ?",
  )
    .bind(row.thread_id, recipient)
    .first<{ token: string }>();
  if (!route) throw new Error("Email route missing");
  await env.DB.prepare(`INSERT OR IGNORE INTO email_delivery
    (message_id, route_token, sender, reply_to, subject, body, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      messageId,
      route.token,
      config.from,
      `reply+${route.token}@${config.replyDomain}`,
      `${config.name} · Support ${row.thread_id.slice(-8)}`,
      row.body,
      Date.now(),
    )
    .run();
}

/** An ambiguous send is held for reconciliation, never automatically duplicated. */
export async function deliverPendingEmails(env: Env): Promise<void> {
  if (!env.EMAIL || !env.EMAIL_INBOXES) return;
  await env.DB.prepare(
    "UPDATE email_delivery SET status = 'unknown' WHERE status = 'sending' AND updated_at < ?",
  )
    .bind(Date.now() - 600_000)
    .run();
  const pending = await env.DB.prepare(`SELECT d.*, r.recipient, t.inbox_id FROM email_delivery d
    JOIN thread_email_route r ON r.token = d.route_token JOIN thread t ON t.id = r.thread_id
    WHERE d.status = 'pending' ORDER BY d.updated_at LIMIT 25`).all<{
    message_id: string;
    sender: string;
    reply_to: string;
    subject: string;
    body: string;
    recipient: string;
    inbox_id: string;
  }>();
  const enabled = settings(env);
  for (const mail of pending.results) {
    if (!enabled[mail.inbox_id]) continue;
    const claim = await env.DB.prepare(
      "UPDATE email_delivery SET status = 'sending', updated_at = ? WHERE message_id = ? AND status = 'pending'",
    )
      .bind(Date.now(), mail.message_id)
      .run();
    if (claim.meta.changes !== 1) continue;
    try {
      const sent = await env.EMAIL.send({
        from: mail.sender,
        to: mail.recipient,
        replyTo: mail.reply_to,
        subject: mail.subject,
        text: mail.body,
        headers: { "Auto-Submitted": "auto-generated" },
      });
      await env.DB.prepare(
        "UPDATE email_delivery SET status = 'sent', provider_id = ?, updated_at = ? WHERE message_id = ?",
      )
        .bind(sent.messageId, Date.now(), mail.message_id)
        .run();
    } catch {
      await env.DB.prepare(
        "UPDATE email_delivery SET status = 'unknown', updated_at = ? WHERE message_id = ?",
      )
        .bind(Date.now(), mail.message_id)
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
  const config = route ? settings(env)[route.inbox_id] : undefined;
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
