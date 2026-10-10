import { acceptOperatorIngress } from "@respondkit/conversations";
import {
  resolveAuthorizedDiscordThread,
  type ParsedDiscordAgentDecisionInteraction,
} from "@respondkit/discord";
import { createDatabase } from "./db";
import type { Env } from "./env";
import { agentOperatorEnvelopeSchema, type AgentOperatorEnvelope } from "./workflows/envelope";

export async function agentReplyState(env: Env, messageId: string) {
  return env.DB.prepare("SELECT status,envelope FROM agent_reply WHERE message_id=?")
    .bind(messageId)
    .first<{ status: string; envelope: string }>();
}

export async function acceptAgentIngress(env: Env, envelope: AgentOperatorEnvelope) {
  const stored = await agentReplyState(env, envelope.messageId);
  if (
    !stored ||
    stored.status !== "approved" ||
    JSON.stringify(JSON.parse(stored.envelope)) !== JSON.stringify(envelope)
  ) {
    throw new Error("Agent reply is not approved or the immutable ingress differs");
  }
  return acceptOperatorIngress(createDatabase(env.DB), {
    id: envelope.messageId,
    workspaceId: envelope.workspaceId,
    inboxId: envelope.inboxId,
    threadId: envelope.threadId,
    workflowInstanceId: envelope.workflowInstanceId,
    acceptedAt: new Date(envelope.acceptedAt),
    originalEnglishText: envelope.originalText,
    replyTranslation: envelope.replyTranslation,
    replyTranslationRequest: envelope.replyTranslationRequest,
    authorKind: "agent",
    authorName: envelope.agent.name,
  });
}

export async function decideAgentDraft(
  env: Env,
  interaction: ParsedDiscordAgentDecisionInteraction,
): Promise<string> {
  if (
    interaction.applicationId !== env.DISCORD_APPLICATION_ID ||
    interaction.threadType !== 11 ||
    !interaction.forumChannelId
  )
    return "This draft action is not authorized.";
  const authorized = await resolveAuthorizedDiscordThread(createDatabase(env.DB), {
    ...interaction,
    forumChannelId: interaction.forumChannelId,
  });
  if (!authorized.ok) return "This draft action is not authorized.";
  if (interaction.action === "translate") {
    const approved =
      await env.DB.prepare(`UPDATE reply_review SET confirmed_by=coalesce(confirmed_by,?)
      WHERE message_id=? AND generation=? AND EXISTS (SELECT 1 FROM message m
      WHERE m.id=reply_review.message_id AND m.author_kind='agent' AND m.thread_id=? AND m.inbox_id=?
      AND m.customer_availability<>'available' AND EXISTS (SELECT 1 FROM agent_reply r WHERE r.message_id=m.id AND r.status='approved')) RETURNING message_id`)
        .bind(
          interaction.operatorUserId,
          interaction.messageId,
          interaction.generation!,
          authorized.thread.threadId,
          authorized.integration.inboxId,
        )
        .first();
    if (!approved) return "This translation is no longer awaiting approval.";
    const state = await agentReplyState(env, interaction.messageId);
    if (!state) throw new Error("Agent reply missing for translation review");
    const envelope = agentOperatorEnvelopeSchema.parse(JSON.parse(state.envelope));
    const instance = await env.MESSAGE_WORKFLOW.get(envelope.workflowInstanceId);
    await instance.sendEvent({
      type: `translation-approved-${interaction.generation}`,
      payload: {},
    });
    return "Agent translation approved for delivery.";
  }
  const row = await env.DB.prepare(
    "SELECT envelope,status FROM agent_reply WHERE message_id=? AND thread_id=? AND inbox_id=? AND mode='draft'",
  )
    .bind(interaction.messageId, authorized.thread.threadId, authorized.integration.inboxId)
    .first<{ envelope: string; status: string }>();
  if (!row) return "Draft not found in this support thread.";
  if (row.status === "rejected") return "Draft rejected; no reply was sent.";
  if (row.status === "stale")
    return "Draft is stale because the conversation changed. Submit a new draft.";
  const available = await env.DB.prepare(
    "SELECT id FROM message WHERE id=? AND customer_availability='available'",
  )
    .bind(interaction.messageId)
    .first();
  if (available) return "Draft approved; the reply is already available in chat.";

  const envelope = agentOperatorEnvelopeSchema.parse(JSON.parse(row.envelope));
  await env.DB.prepare(
    "UPDATE agent_reply SET status=?,decided_by=?,decided_at=? WHERE message_id=? AND status='pending'",
  )
    .bind(
      interaction.action === "approve" ? "approved" : "rejected",
      interaction.operatorUserId,
      Date.now(),
      interaction.messageId,
    )
    .run();
  const canonical = await agentReplyState(env, interaction.messageId);
  if (!canonical) throw new Error("Draft disappeared during approval");
  const instance = await env.MESSAGE_WORKFLOW.get(envelope.workflowInstanceId);
  const status = await instance.status();
  if (!["complete", "errored", "terminated"].includes(status.status)) {
    await instance.sendEvent({ type: "agent-decision", payload: {} });
  }
  if (canonical.status === "stale")
    return "Draft is stale because the conversation changed. Submit a new draft.";
  return canonical.status === "rejected"
    ? "Draft rejected; no reply was sent."
    : status.status === "errored" || status.status === "terminated"
      ? "Approval recorded, but the workflow failed. Check the agent reply status before retrying."
      : "Draft approved for delivery. Repeated approval will not send another reply.";
}
