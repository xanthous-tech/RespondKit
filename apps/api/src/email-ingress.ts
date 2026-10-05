import { deriveCustomerMessageIdentity } from "@respondkit/protocol";
import { emailSettings } from "./email-config";
import {
  captureEmail,
  customerEmailPreview,
  emailHash,
  emailPreview,
  publicEmailUrl,
  storeEmailAttachments,
} from "./email-content";
import type { Env } from "./env";
import { acceptWorkflow } from "./workflow-binding";
import { messageWorkflowEnvelopeSchema, type MessageWorkflowEnvelope } from "./workflows/envelope";

export type IncomingEmail = Pick<
  ForwardableEmailMessage,
  "from" | "to" | "headers" | "raw" | "rawSize" | "setReject"
>;
type Route = {
  recipient: string | null;
  config_json: string | null;
  thread_id: string;
  workspace_id: string;
  inbox_id: string;
  visitor_id: string;
  status: string;
  current_email: string | null;
};
function automated(headers: Headers) {
  const value = headers.get("auto-submitted");
  return (
    (value !== null && value.toLowerCase() !== "no") ||
    /^(bulk|list|junk)$/i.test(headers.get("precedence") ?? "")
  );
}
export async function receiveThreadEmail(message: IncomingEmail, env: Env): Promise<void> {
  const reject = (reason: string) => message.setReject(reason);
  const address = /^(reply|operator)\+([a-f0-9]{32})@(.+)$/i.exec(message.to);
  if (!address) return reject("Unknown support reply address");
  const operator = address[1]!.toLowerCase() === "operator";
  const token = address[2]!.toLowerCase();
  const sender = message.from.toLowerCase();
  const route = await env.DB.prepare(
    operator
      ? `SELECT NULL AS recipient,r.config_json,t.id AS thread_id,t.workspace_id,t.inbox_id,t.visitor_id,t.status,v.email AS current_email
      FROM operator_email_route r JOIN thread t ON t.id=r.thread_id JOIN visitor v ON v.id=t.visitor_id WHERE r.token=?`
      : `SELECT r.recipient,NULL AS config_json,t.id AS thread_id,t.workspace_id,t.inbox_id,t.visitor_id,t.status,v.email AS current_email
      FROM thread_email_route r JOIN thread t ON t.id=r.thread_id JOIN visitor v ON v.id=t.visitor_id WHERE r.token=?`,
  )
    .bind(token)
    .first<Route>();
  const config = route ? await emailSettings(env, route.inbox_id) : undefined;
  if (
    !route ||
    !config ||
    config.replyDomain !== address[3]?.toLowerCase() ||
    (operator
      ? !config.operator?.allowedReplyFrom.includes(sender) ||
        route.config_json !== JSON.stringify(config)
      : route.recipient !== sender || route.current_email?.toLowerCase() !== sender)
  ) {
    return reject("Unknown support reply address or sender");
  }
  if (route.status !== "open")
    return reject("This conversation is closed. Start a new conversation in the app.");
  if (automated(message.headers)) return reject("Automated replies are not accepted");
  const sourceId = message.headers.get("message-id");
  if (!sourceId || sourceId.length > 998 || /[\r\n]/.test(sourceId))
    return reject("A valid Message-ID is required");
  // Keep the original customer identity derivation for compatibility with earlier email ingress.
  const digest = await emailHash(JSON.stringify([token, sourceId]));
  const clientMessageId = `email_${digest}`;
  const identity = operator
    ? { messageId: `msg_email_${digest}`, workflowInstanceId: `email_${digest}` }
    : await deriveCustomerMessageIdentity({
        workspaceId: route.workspace_id,
        threadId: route.thread_id,
        clientMessageId,
      });
  const existing = await env.DB.prepare("SELECT envelope FROM email_ingress WHERE id=?")
    .bind(identity.messageId)
    .first<{ envelope: string }>();
  if (!existing) {
    // Validate storage/link configuration before accepting any bytes. No application file-size limit.
    publicEmailUrl(env, "/");
    const parsed = await captureEmail(env, identity.messageId, message.raw);
    if (parsed.messageId !== sourceId || parsed.from?.address?.toLowerCase() !== sender)
      return reject("Email headers do not match the authorized sender and Message-ID");
    const parsedHeaders = new Headers(parsed.headers.map((header) => [header.key, header.value]));
    if (automated(parsedHeaders)) return reject("Automated replies are not accepted");
    const attachments = await storeEmailAttachments(
      env,
      {
        ...identity,
        workspaceId: route.workspace_id,
        inboxId: route.inbox_id,
        visitorId: route.visitor_id,
      },
      parsed.attachments,
    );
    const common = {
      schema: "respondkit.workflow-message/1" as const,
      ...identity,
      workspaceId: route.workspace_id,
      inboxId: route.inbox_id,
      threadId: route.thread_id,
      visitorId: route.visitor_id,
      acceptedAt: new Date().toISOString(),
      originalText: customerEmailPreview(await emailPreview(parsed)),
      attachments,
    };
    const envelope: MessageWorkflowEnvelope = operator
      ? {
          ...common,
          direction: "operator_to_customer",
          source: "email",
          replyTranslation: "off",
          email: { routeToken: token, sender },
        }
      : {
          ...common,
          direction: "customer_to_operator",
          clientMessageId,
          context: { email: sender },
        };
    const canonical = messageWorkflowEnvelopeSchema.parse(envelope);
    await env.DB.prepare("INSERT OR IGNORE INTO email_ingress(id,envelope) VALUES (?,?)")
      .bind(identity.messageId, JSON.stringify(canonical))
      .run();
  }
  const stored = await env.DB.prepare("SELECT envelope FROM email_ingress WHERE id=?")
    .bind(identity.messageId)
    .first<{ envelope: string }>();
  if (!stored) throw new Error("Email ingress missing");
  const canonical = messageWorkflowEnvelopeSchema.parse(JSON.parse(stored.envelope));
  const accepted = await acceptWorkflow(
    env.MESSAGE_WORKFLOW,
    identity.workflowInstanceId,
    canonical,
  );
  if (accepted.kind === "unknown")
    throw new Error("Email workflow acceptance unknown; retry delivery");
}
