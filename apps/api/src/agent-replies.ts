import { acceptOperatorIngress } from "@respondkit/conversations";
import {
  languageLabel,
  resolveAuthorizedDiscordThread,
  type ParsedDiscordAgentDecisionInteraction,
  type ParsedDiscordAgentContextInteraction,
  type ParsedDiscordRetranslateInteraction,
} from "@respondkit/discord";
import { agentTokenHash } from "./agent-api";
import { translationEnabled } from "./translation-service";
import { acceptWorkflow } from "./workflow-binding";
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
  const decision =
    env.DB.prepare(`UPDATE agent_reply SET status=?,decided_by=?,decided_at=? WHERE message_id=? AND status='pending'
    AND (?=0 OR ?='reject' OR EXISTS (SELECT 1 FROM agent_draft_preview p WHERE p.message_id=agent_reply.message_id AND p.posted_at IS NOT NULL))`).bind(
      interaction.action === "approve" ? "approved" : "rejected",
      interaction.operatorUserId,
      Date.now(),
      interaction.messageId,
      envelope.agent.previewTranslation ? 1 : 0,
      interaction.action,
    );
  if (envelope.agent.previewTranslation) {
    await env.DB.batch([
      decision,
      env.DB.prepare(`UPDATE agent_draft_preview SET confirmed_by=(SELECT decided_by FROM agent_reply WHERE message_id=?)
        WHERE message_id=? AND posted_at IS NOT NULL AND confirmed_by IS NULL AND ?='approve'
        AND EXISTS (SELECT 1 FROM agent_reply r WHERE r.message_id=agent_draft_preview.message_id AND r.status='approved')`).bind(
        interaction.messageId,
        interaction.messageId,
        interaction.action,
      ),
    ]);
  } else {
    await decision.run();
  }
  const canonical = await agentReplyState(env, interaction.messageId);
  if (!canonical) throw new Error("Draft disappeared during approval");
  if (canonical.status === "pending")
    return "The translation preview is not fully posted yet. Try again after it is ready.";
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

const DISCORD_MESSAGE_ID = /(\d{17,20})\/?$/;

/**
 * /retranslate: the operator names the language for a pending agent draft whose
 * customer language RespondKit could not detect. The draft's identity is
 * immutable, so this files a superseding draft (same English text, same agent,
 * same conversation basis) with a translation preview in the new language and
 * marks the old one stale; the operator approves the new one as usual. It also
 * records the language on the thread, so later "customer" translations follow it.
 * Idempotent per draft and language.
 */
export async function retranslateAgentDraft(
  env: Env,
  interaction: ParsedDiscordRetranslateInteraction & { readonly translate: string },
): Promise<string> {
  if (!interaction.forumChannelId || interaction.threadType !== 11)
    return "This command is not authorized.";
  const authorized = await resolveAuthorizedDiscordThread(createDatabase(env.DB), {
    ...interaction,
    forumChannelId: interaction.forumChannelId,
  });
  if (!authorized.ok) return "This command is not authorized.";
  const threadId = authorized.thread.threadId;
  const inboxId = authorized.integration.inboxId;
  if (!translationEnabled(env, inboxId)) return "Translation is not enabled for this inbox.";

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
  const language = interaction.translate;
  const previous = agentOperatorEnvelopeSchema.parse(JSON.parse(row.envelope));
  const key = `${row.idempotency_key}:retranslate:${language}`.slice(0, 200);
  const identity = await agentTokenHash(JSON.stringify([inboxId, key]));
  const newMessageId = `msg_agent_${identity}`;
  const already = await env.DB.prepare("SELECT status FROM agent_reply WHERE message_id=?")
    .bind(newMessageId)
    .first<{ status: string }>();
  if (!already) {
    if (row.status !== "pending") {
      return row.status === "stale"
        ? "That draft is stale: the conversation moved on. Ask the agent for a new draft with /agent."
        : `That draft is already ${row.status}; nothing to translate again.`;
    }
    if (previous.replyTranslation === language) {
      return `That draft is already translated into ${languageLabel(language)}.`;
    }
    const envelope = agentOperatorEnvelopeSchema.parse({
      ...previous,
      messageId: newMessageId,
      workflowInstanceId: `agent_${identity}`,
      acceptedAt: new Date().toISOString(),
      replyTranslation: language,
      replyTranslationRequest: language,
      agent: { ...previous.agent, previewTranslation: true },
    });
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO agent_reply(message_id,workspace_id,inbox_id,thread_id,idempotency_key,request_json,envelope,mode,status,basis_row_id,created_at)
        SELECT ?,workspace_id,inbox_id,id,?,?,?,'draft','pending',?,? FROM thread WHERE id=? AND inbox_id=? AND status='open'
        AND EXISTS (SELECT 1 FROM agent_reply WHERE message_id=? AND status='pending')
        ON CONFLICT(inbox_id,idempotency_key) DO NOTHING`).bind(
        newMessageId,
        key,
        JSON.stringify({
          threadId,
          text: previous.originalText,
          idempotencyKey: key,
          translate: language,
          mode: "draft",
          retranslatedFrom: messageId,
          by: interaction.operatorUserId,
        }),
        JSON.stringify(envelope),
        row.basis_row_id,
        now,
        threadId,
        inboxId,
        messageId,
      ),
      env.DB.prepare(
        "UPDATE agent_reply SET status='stale' WHERE message_id=? AND status='pending' AND EXISTS (SELECT 1 FROM agent_reply WHERE message_id=?)",
      ).bind(messageId, newMessageId),
      env.DB.prepare(
        "UPDATE thread SET customer_language=?, customer_language_updated_at=? WHERE id=? AND inbox_id=? AND EXISTS (SELECT 1 FROM agent_reply WHERE message_id=?)",
      ).bind(language, now, threadId, inboxId, newMessageId),
    ]);
    const created = await env.DB.prepare("SELECT status FROM agent_reply WHERE message_id=?")
      .bind(newMessageId)
      .first<{ status: string }>();
    if (!created)
      return "That draft changed meanwhile (approved, rejected or overtaken). Nothing was translated.";
    // The old draft's workflow waits for a decision: wake it so it sees the draft is stale and ends.
    try {
      const old = await env.MESSAGE_WORKFLOW.get(previous.workflowInstanceId);
      const state = await old.status();
      if (!["complete", "errored", "terminated"].includes(state.status)) {
        await old.sendEvent({ type: "agent-decision", payload: {} });
      }
    } catch (error) {
      console.error("retranslate: could not end the superseded draft's workflow", error);
    }
    await acceptWorkflow(env.MESSAGE_WORKFLOW, envelope.workflowInstanceId, envelope);
  }
  return `Translating the draft into ${languageLabel(language)} as a new draft. Approve the new draft below once its preview is posted. The old draft is no longer approvable, and this thread's customer language is now ${languageLabel(language)}.`;
}
