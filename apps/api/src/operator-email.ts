import { acceptOperatorIngress } from "@respondkit/conversations";
import { emailConfigurationSchema } from "@respondkit/workspaces";
import { createDatabase } from "./db";
import { emailSettings } from "./email-config";
import { outgoingEmailContent, randomToken } from "./email-content";
import type { Env } from "./env";
import type { EmailOperatorEnvelope } from "./workflows/envelope";

/** Re-check revocation when the asynchronous workflow starts, not just at SMTP ingress. */
export async function acceptOperatorEmailIngress(env: Env, envelope: EmailOperatorEnvelope) {
  const stored = await env.DB.prepare("SELECT envelope FROM email_ingress WHERE id=?")
    .bind(envelope.messageId)
    .first<{ envelope: string }>();
  const route = await env.DB.prepare(
    "SELECT thread_id,config_json FROM operator_email_route WHERE token=?",
  )
    .bind(envelope.email.routeToken)
    .first<{ thread_id: string; config_json: string }>();
  const config = await emailSettings(env, envelope.inboxId);
  if (
    !stored ||
    JSON.stringify(JSON.parse(stored.envelope)) !== JSON.stringify(envelope) ||
    !route ||
    route.thread_id !== envelope.threadId ||
    JSON.stringify(config) !== route.config_json ||
    !config?.operator?.allowedReplyFrom.includes(envelope.email.sender)
  ) {
    throw new Error("Operator email authorization was revoked or ingress differs");
  }
  return acceptOperatorIngress(createDatabase(env.DB), {
    id: envelope.messageId,
    workspaceId: envelope.workspaceId,
    inboxId: envelope.inboxId,
    threadId: envelope.threadId,
    workflowInstanceId: envelope.workflowInstanceId,
    acceptedAt: new Date(envelope.acceptedAt),
    originalEnglishText: envelope.originalText,
    authorKind: "email",
    authorName: envelope.email.sender,
    replyTranslation: "off",
    attachments: envelope.attachments ?? [],
  });
}

/** Independent outbox: a Discord outage must not prevent notification of the operator. */
export async function deliverOperatorEmails(env: Env): Promise<void> {
  if (!env.EMAIL) return;
  await env.DB.prepare(
    "UPDATE operator_email_delivery SET status='unknown' WHERE status='sending' AND updated_at<?",
  )
    .bind(Date.now() - 600_000)
    .run();
  const pending =
    await env.DB.prepare(`SELECT d.message_id,d.config_json,m.thread_id,m.inbox_id,m.original_text
    FROM operator_email_delivery d JOIN message m ON m.id=d.message_id
    WHERE d.status='pending' ORDER BY m.accepted_at,m.row_id LIMIT 25`).all<{
      message_id: string;
      config_json: string;
      thread_id: string;
      inbox_id: string;
      original_text: string;
    }>();
  for (const item of pending.results) {
    const snapshot = emailConfigurationSchema.parse(JSON.parse(item.config_json));
    const config = await emailSettings(env, item.inbox_id);
    if (!config?.operator || JSON.stringify(config) !== JSON.stringify(snapshot)) {
      await env.DB.prepare(
        "UPDATE operator_email_delivery SET status='cancelled',updated_at=? WHERE message_id=? AND status='pending'",
      )
        .bind(Date.now(), item.message_id)
        .run();
      continue;
    }
    const configuration = JSON.stringify(config);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO operator_email_route(token,thread_id,config_json) VALUES (?,?,?)",
    )
      .bind(randomToken(), item.thread_id, configuration)
      .run();
    const route = await env.DB.prepare(
      "SELECT token FROM operator_email_route WHERE thread_id=? AND config_json=?",
    )
      .bind(item.thread_id, configuration)
      .first<{ token: string }>();
    if (!route) throw new Error("Operator email route missing");
    // Build content before the claim: a missing object/configuration is retryable without sending.
    const content = await outgoingEmailContent(env, item.message_id, item.original_text, true);
    const claimed =
      await env.DB.prepare(`UPDATE operator_email_delivery SET status='sending',route_token=?,updated_at=?
      WHERE message_id=? AND status='pending' AND NOT EXISTS
      (SELECT 1 FROM operator_email_delivery WHERE route_token=? AND status='sending') RETURNING message_id`)
        .bind(route.token, Date.now(), item.message_id, route.token)
        .first();
    if (!claimed) continue;
    // Re-check the configuration immediately before external delivery.
    if (JSON.stringify(await emailSettings(env, item.inbox_id)) !== configuration) {
      await env.DB.prepare(
        "UPDATE operator_email_delivery SET status='cancelled',updated_at=? WHERE message_id=?",
      )
        .bind(Date.now(), item.message_id)
        .run();
      continue;
    }
    const previous = await env.DB.prepare(`SELECT provider_id FROM operator_email_delivery
      WHERE route_token=? AND status='sent' ORDER BY updated_at DESC LIMIT 1`)
      .bind(route.token)
      .first<{ provider_id: string }>();
    const reference = previous?.provider_id?.replace(/^<|>$/g, "");
    try {
      const sent = await env.EMAIL.send({
        from: config.from,
        to: config.operator.forwardTo,
        replyTo: `operator+${route.token}@${config.replyDomain}`,
        subject: `${config.name} · Support ${item.thread_id.slice(-8)}`,
        ...content,
        headers: {
          "Auto-Submitted": "auto-generated",
          ...(reference && !/[\r\n]/.test(reference)
            ? { "In-Reply-To": `<${reference}>`, References: `<${reference}>` }
            : {}),
        },
      });
      await env.DB.prepare(
        "UPDATE operator_email_delivery SET status='sent',provider_id=?,updated_at=? WHERE message_id=?",
      )
        .bind(sent.messageId, Date.now(), item.message_id)
        .run();
    } catch {
      await env.DB.prepare(
        "UPDATE operator_email_delivery SET status='unknown',updated_at=? WHERE message_id=?",
      )
        .bind(Date.now(), item.message_id)
        .run();
    }
  }
}
