import { acceptOperatorIngress } from "@respondkit/conversations";
import {
  languageLabel,
  resolveAuthorizedDiscordThread,
  type ParsedDiscordAgentDecisionInteraction,
  type ParsedDiscordAgentContextInteraction,
  type ParsedDiscordApproveInteraction,
} from "@respondkit/discord";
import { agentTokenHash } from "./agent-api";
import { translationEnabled } from "./translation-service";
import { acceptWorkflow, workflowStatus } from "./workflow-binding";
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

const DISCORD_MESSAGE_ID = /(\d{17,20})\/?$/;

/**
 * /approve: approve an agent draft named by its Discord message (link or ID).
 * Without a language, or with the draft's own language, this is the Approve draft
 * message command. With another language ("customer" is the thread's recorded
 * language), the draft's identity is immutable, so it files a superseding reply
 * (same English text, agent and conversation basis) in that language, already
 * approved by this operator, marks the old draft stale and records the language on
 * the thread, all in one batch. The new translation is not previewed, so the usual
 * review gate applies: if it needs review, the Approve translation button follows.
 * Idempotent per draft and language.
 */
export async function approveAgentDraftCommand(
  env: Env,
  interaction: ParsedDiscordApproveInteraction,
): Promise<string> {
  if (
    interaction.applicationId !== env.DISCORD_APPLICATION_ID ||
    !interaction.forumChannelId ||
    interaction.threadType !== 11
  )
    return "This command is not authorized.";
  const authorized = await resolveAuthorizedDiscordThread(createDatabase(env.DB), {
    ...interaction,
    forumChannelId: interaction.forumChannelId,
  });
  if (!authorized.ok) return "This command is not authorized.";
  const threadId = authorized.thread.threadId;
  const inboxId = authorized.integration.inboxId;

  const draftRef = interaction.draft.trim();
  let messageId: string | null = /^msg_agent_[a-f0-9]{64}$/.test(draftRef) ? draftRef : null;
  if (messageId === null) {
    const discordMessageId = DISCORD_MESSAGE_ID.exec(draftRef)?.[1];
    if (discordMessageId === undefined) return "Give the draft's Discord message link or ID.";
    const chunk = await env.DB.prepare(
      "SELECT message_id FROM agent_draft_chunk WHERE discord_message_id=? AND discord_thread_id=?",
    )
      .bind(discordMessageId, interaction.discordThreadId)
      .first<{ message_id: string }>();
    if (!chunk) return "That message is not an agent draft in this support thread.";
    messageId = chunk.message_id;
  }
  const row = await env.DB.prepare(
    "SELECT idempotency_key,envelope,status,basis_row_id FROM agent_reply WHERE message_id=? AND thread_id=? AND inbox_id=? AND mode='draft'",
  )
    .bind(messageId, threadId, inboxId)
    .first<{ idempotency_key: string; envelope: string; status: string; basis_row_id: number }>();
  if (!row) return "That message is not an agent draft in this support thread.";
  const previous = agentOperatorEnvelopeSchema.parse(JSON.parse(row.envelope));

  let language = interaction.translate;
  if (language === "customer") {
    const thread = await env.DB.prepare("SELECT customer_language FROM thread WHERE id=?")
      .bind(threadId)
      .first<{ customer_language: string | null }>();
    if (!thread?.customer_language)
      return "This thread's customer language is unknown. Name the language instead, for example translate:Burmese.";
    language = thread.customer_language;
  }
  const decide = () =>
    decideAgentDraft(env, {
      ...interaction,
      command: "agent_decision",
      action: "approve",
      messageId: messageId!,
    });
  if (language === undefined || language === previous.replyTranslation) return decide();
  if (language !== "off" && !translationEnabled(env, inboxId))
    return "Translation is not enabled for this inbox.";

  const key = `${row.idempotency_key}:approve:${language}`.slice(0, 200);
  const identity = await agentTokenHash(JSON.stringify([inboxId, key]));
  const newMessageId = `msg_agent_${identity}`;
  const label = language === "off" ? "untranslated English" : languageLabel(language);
  const already = await env.DB.prepare("SELECT status FROM agent_reply WHERE message_id=?")
    .bind(newMessageId)
    .first<{ status: string }>();
  if (!already) {
    if (row.status !== "pending") {
      return row.status === "stale"
        ? "That draft is stale: the conversation moved on. Ask the agent for a new draft with /agent."
        : `That draft is already ${row.status}.`;
    }
    const envelope = agentOperatorEnvelopeSchema.parse({
      ...previous,
      messageId: newMessageId,
      workflowInstanceId: `agent_${identity}`,
      acceptedAt: new Date().toISOString(),
      replyTranslation: language,
      replyTranslationRequest: interaction.translate,
      // Approved here, so no draft step: the workflow goes straight to translation and delivery.
      agent: { name: previous.agent.name, mode: "send" },
    });
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO agent_reply(message_id,workspace_id,inbox_id,thread_id,idempotency_key,request_json,envelope,mode,status,decided_by,decided_at,basis_row_id,created_at)
        SELECT ?,workspace_id,inbox_id,id,?,?,?,'send','approved',?,?,?,? FROM thread WHERE id=? AND inbox_id=? AND status='open'
        AND EXISTS (SELECT 1 FROM agent_reply WHERE message_id=? AND status='pending')
        ON CONFLICT(inbox_id,idempotency_key) DO NOTHING`).bind(
        newMessageId,
        key,
        JSON.stringify({
          threadId,
          text: previous.originalText,
          idempotencyKey: key,
          translate: interaction.translate,
          mode: "send",
          approvedFrom: messageId,
          by: interaction.operatorUserId,
        }),
        JSON.stringify(envelope),
        interaction.operatorUserId,
        now,
        row.basis_row_id,
        now,
        threadId,
        inboxId,
        messageId,
      ),
      env.DB.prepare(
        "UPDATE agent_reply SET status='stale' WHERE message_id=? AND status='pending' AND EXISTS (SELECT 1 FROM agent_reply WHERE message_id=?)",
      ).bind(messageId, newMessageId),
      ...(language === "off"
        ? []
        : [
            env.DB.prepare(
              "UPDATE thread SET customer_language=?, customer_language_updated_at=? WHERE id=? AND inbox_id=? AND EXISTS (SELECT 1 FROM agent_reply WHERE message_id=?)",
            ).bind(language, now, threadId, inboxId, newMessageId),
          ]),
    ]);
    const created = await env.DB.prepare("SELECT status FROM agent_reply WHERE message_id=?")
      .bind(newMessageId)
      .first<{ status: string }>();
    if (!created)
      return "That draft changed meanwhile (approved, rejected or overtaken). Nothing was sent.";
    // The old draft's workflow waits for a decision: wake it so it sees the draft is stale and ends.
    try {
      const old = await env.MESSAGE_WORKFLOW.get(previous.workflowInstanceId);
      const state = await old.status();
      if (!["complete", "errored", "terminated"].includes(state.status)) {
        await old.sendEvent({ type: "agent-decision", payload: {} });
      }
    } catch (error) {
      console.error("approve: could not end the superseded draft's workflow", error);
    }
  }
  const available = await env.DB.prepare(
    "SELECT id FROM message WHERE id=? AND customer_availability='available'",
  )
    .bind(newMessageId)
    .first();
  if (available) return `Draft approved in ${label}; the reply is already available in chat.`;
  // Start the delivery workflow, or report on the one already started by an earlier /approve.
  let status = (await workflowStatus(env.MESSAGE_WORKFLOW, `agent_${identity}`))?.status;
  if (status === undefined) {
    const stored = await env.DB.prepare("SELECT envelope FROM agent_reply WHERE message_id=?")
      .bind(newMessageId)
      .first<{ envelope: string }>();
    const envelope = agentOperatorEnvelopeSchema.parse(JSON.parse(stored!.envelope));
    const acceptance = await acceptWorkflow(
      env.MESSAGE_WORKFLOW,
      envelope.workflowInstanceId,
      envelope,
    );
    if (acceptance.kind === "unknown")
      return `Draft approved in ${label}, but delivery could not be confirmed. Run /approve again to retry; it will not send twice.`;
    status = acceptance.kind === "existing" ? acceptance.status.status : "queued";
  }
  if (status === "errored" || status === "terminated")
    return `Approval in ${label} recorded, but the workflow failed. Check the agent reply status before retrying.`;
  return `Draft approved in ${label} for delivery.${language === "off" ? "" : ` If the translation needs review, an Approve translation button follows. This thread's customer language is now ${label}.`} Repeated approval will not send another reply.`;
}
