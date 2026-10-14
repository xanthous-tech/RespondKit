import { acceptOperatorIngress } from "@respondkit/conversations";
import {
  resolveAuthorizedDiscordThread,
  type ParsedDiscordAgentDecisionInteraction,
  type ParsedDiscordAgentContextInteraction,
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
  interaction: ParsedDiscordAgentDecisionInteraction | ParsedDiscordAgentContextInteraction,
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
  if (interaction.command === "agent_context") {
    const chunk = await env.DB.prepare(
      "SELECT message_id FROM agent_draft_chunk WHERE discord_message_id=? AND discord_thread_id=?",
    )
      .bind(interaction.targetMessageId, interaction.discordThreadId)
      .first<{ message_id: string }>();
    if (!chunk) return "Draft not found in this support thread.";
    return decideAgentDraft(env, {
      ...interaction,
      command: "agent_decision",
      messageId: chunk.message_id,
    });
  }
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
  const outcome = await applyAgentDraftDecision(env, {
    messageId: interaction.messageId,
    threadId: authorized.thread.threadId,
    inboxId: authorized.integration.inboxId,
    action: interaction.action === "approve" ? "approve" : "reject",
    decidedBy: interaction.operatorUserId,
  });
  return DECISION_TEXT[outcome];
}

export type AgentDraftOutcome =
  | "not-found"
  | "rejected"
  | "stale"
  | "available"
  | "preview-pending"
  | "approved"
  | "approved-workflow-failed";

const DECISION_TEXT: Record<AgentDraftOutcome, string> = {
  "not-found": "Draft not found in this support thread.",
  rejected: "Draft rejected; no reply was sent.",
  stale: "Draft is stale because the conversation changed. Submit a new draft.",
  available: "Draft approved; the reply is already available in chat.",
  "preview-pending":
    "The translation preview is not fully posted yet. Try again after it is ready.",
  approved: "Draft approved for delivery. Repeated approval will not send another reply.",
  "approved-workflow-failed":
    "Approval recorded, but the workflow failed. Check the agent reply status before retrying.",
};

/**
 * Approves or rejects one pending agent draft. The status changes only from
 * pending, in one conditional UPDATE, so an operator's tap and an agent's
 * timeout approval racing each other deliver it at most once; a draft a new
 * message, an operator reply or a steer made stale is never published.
 */
export async function applyAgentDraftDecision(
  env: Env,
  input: {
    messageId: string;
    threadId: string;
    inboxId: string;
    action: "approve" | "reject";
    decidedBy: string;
  },
): Promise<AgentDraftOutcome> {
  const row = await env.DB.prepare(
    "SELECT envelope,status FROM agent_reply WHERE message_id=? AND thread_id=? AND inbox_id=? AND mode='draft'",
  )
    .bind(input.messageId, input.threadId, input.inboxId)
    .first<{ envelope: string; status: string }>();
  if (!row) return "not-found";
  if (row.status === "rejected") return "rejected";
  if (row.status === "stale") return "stale";
  const available = await env.DB.prepare(
    "SELECT id FROM message WHERE id=? AND customer_availability='available'",
  )
    .bind(input.messageId)
    .first();
  if (available) return "available";

  const envelope = agentOperatorEnvelopeSchema.parse(JSON.parse(row.envelope));
  const decision =
    env.DB.prepare(`UPDATE agent_reply SET status=?,decided_by=?,decided_at=? WHERE message_id=? AND status='pending'
    AND (?=0 OR ?='reject' OR EXISTS (SELECT 1 FROM agent_draft_preview p WHERE p.message_id=agent_reply.message_id AND p.posted_at IS NOT NULL))`).bind(
      input.action === "approve" ? "approved" : "rejected",
      input.decidedBy,
      Date.now(),
      input.messageId,
      envelope.agent.previewTranslation ? 1 : 0,
      input.action,
    );
  if (envelope.agent.previewTranslation) {
    await env.DB.batch([
      decision,
      env.DB.prepare(`UPDATE agent_draft_preview SET confirmed_by=(SELECT decided_by FROM agent_reply WHERE message_id=?)
        WHERE message_id=? AND posted_at IS NOT NULL AND confirmed_by IS NULL AND ?='approve'
        AND EXISTS (SELECT 1 FROM agent_reply r WHERE r.message_id=agent_draft_preview.message_id AND r.status='approved')`).bind(
        input.messageId,
        input.messageId,
        input.action,
      ),
    ]);
  } else {
    await decision.run();
  }
  const canonical = await agentReplyState(env, input.messageId);
  if (!canonical) throw new Error("Draft disappeared during approval");
  if (canonical.status === "pending") return "preview-pending";
  const instance = await env.MESSAGE_WORKFLOW.get(envelope.workflowInstanceId);
  const status = await instance.status();
  if (!["complete", "errored", "terminated"].includes(status.status)) {
    await instance.sendEvent({ type: "agent-decision", payload: {} });
  }
  if (canonical.status === "stale") return "stale";
  if (canonical.status === "rejected") return "rejected";
  return status.status === "errored" || status.status === "terminated"
    ? "approved-workflow-failed"
    : "approved";
}
