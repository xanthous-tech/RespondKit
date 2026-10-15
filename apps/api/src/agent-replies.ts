import { acceptOperatorIngress } from "@respondkit/conversations";
import {
  languageLabel,
  resolveAuthorizedDiscordThread,
  type ParsedDiscordAgentDecisionInteraction,
  type ParsedDiscordAgentContextInteraction,
  type ParsedDiscordApproveInteraction,
} from "@respondkit/discord";
import { deliverNote, type InternalNote } from "./agent-notes";
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
  const scope = {
    workspaceId: authorized.integration.workspaceId,
    inboxId: authorized.integration.inboxId,
    threadId: authorized.thread.threadId,
  };
  // Approve draft (right-click) is /approve on that message with the default language.
  if (interaction.command === "agent_context")
    return handBackAgentDraft(env, interaction, scope, interaction.targetMessageId, "customer");
  // An Approve button on a draft posted before drafts lost their buttons follows the same rule.
  if (interaction.action === "approve")
    return handBackAgentDraft(env, interaction, scope, interaction.messageId, "customer");
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
    action: "reject",
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
const NOT_A_DRAFT = "That message is not an agent draft in this support thread.";

/**
 * The machine line of an approval note, `approve:{...}` between backticks; the English
 * text follows it verbatim. The support runner wakes on it and sends the reply with
 * `rk send-approved`, which checks the draft, the hash and that nothing newer arrived.
 */
export interface DraftApproval {
  /** The approved draft's RespondKit message ID (msg_agent_...). */
  readonly draft: string;
  /** A language code ("en" sends the English as written), or "customer" when the thread's language is unknown. */
  readonly language: string;
  /** SHA-256 (hex) of the English text after the line. */
  readonly sha256: string;
  /** The approving operator's Discord user ID. */
  readonly by: string;
}

export const APPROVAL_MARKER = "approve:";

export function draftApprovalNote(approval: DraftApproval, english: string, draftLink: string) {
  const draft = draftLink === "" ? "this draft" : `[this draft](${draftLink})`;
  const action =
    approval.language === "en"
      ? "send it in English, as written"
      : `translate it into ${languageName(approval.language)} and send it`;
  return `Approved ${draft}: ${action}.\n\`${APPROVAL_MARKER}${JSON.stringify(approval)}\`\n${english}`;
}

function languageName(language: string) {
  return language === "customer"
    ? "the customer's language (inferred from the thread)"
    : languageLabel(language);
}

/** What happens next, after "Handed to the agent: " or "<operator> already handed ...: ". */
function nextStep(language: string) {
  return language === "en"
    ? "it will send this reply in English, as written, and post it here."
    : `it will translate this reply into ${languageName(language)}, send it, and post both versions here.`;
}

/** What the operator is told after an approval: who sends what, and where it shows up. */
export function handedBackText(language: string) {
  return `Handed to the agent: ${nextStep(language)}`;
}

async function sha256Hex(text: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const when = (ms: number) => `<t:${Math.floor(ms / 1000)}:f>`;

/** A reply or customer message that is not a pending draft, described for the operator. */
async function notADraft(env: Env, scope: { threadId: string }, messageId: string) {
  const message = await env.DB.prepare(
    "SELECT direction,customer_availability,accepted_at FROM message WHERE id=? AND thread_id=?",
  )
    .bind(messageId, scope.threadId)
    .first<{ direction: string; customer_availability: string; accepted_at: number }>();
  if (!message) return NOT_A_DRAFT;
  if (message.direction === "customer_to_operator")
    return "That is a customer message, not an agent draft.";
  return message.customer_availability === "available"
    ? `That reply was already sent to the customer (${when(message.accepted_at)}); it is not a draft. Use /reply to send a correction.`
    : "That reply is already on its way to the customer; it is not a draft. Check the thread in a minute.";
}

/**
 * Approving an agent draft never sends it from here: it records the approval as an
 * operator steer note (`approve:` line, the English text after it), which stales the
 * draft (trigger 0011, so no other approval can publish it) and wakes the agent. The
 * agent translates the English, sends it and posts both versions in the thread.
 * /approve, Approve draft and old Approve buttons all come here; idempotent per interaction.
 */
async function handBackAgentDraft(
  env: Env,
  interaction:
    | ParsedDiscordApproveInteraction
    | ParsedDiscordAgentDecisionInteraction
    | ParsedDiscordAgentContextInteraction,
  scope: { workspaceId: string; inboxId: string; threadId: string },
  draftRef: string,
  translate: string,
): Promise<string> {
  let messageId: string | null = /^msg_agent_[a-f0-9]{64}$/.test(draftRef) ? draftRef : null;
  if (messageId === null) {
    const discordMessageId = DISCORD_MESSAGE_ID.exec(draftRef)?.[1];
    if (discordMessageId === undefined) return "Give the draft's Discord message link or ID.";
    const chunk = await env.DB.prepare(
      "SELECT message_id FROM agent_draft_chunk WHERE discord_message_id=? AND discord_thread_id=?",
    )
      .bind(discordMessageId, interaction.discordThreadId)
      .first<{ message_id: string }>();
    if (!chunk) {
      const posted = await env.DB.prepare(
        "SELECT message_id FROM discord_message WHERE discord_message_id=? AND discord_thread_id=?",
      )
        .bind(discordMessageId, interaction.discordThreadId)
        .first<{ message_id: string }>();
      return posted ? notADraft(env, scope, posted.message_id) : NOT_A_DRAFT;
    }
    messageId = chunk.message_id;
  }
  const row = await env.DB.prepare(
    "SELECT envelope,status,mode FROM agent_reply WHERE message_id=? AND thread_id=? AND inbox_id=?",
  )
    .bind(messageId, scope.threadId, scope.inboxId)
    .first<{ envelope: string; status: string; mode: string }>();
  if (!row) return notADraft(env, scope, messageId);
  if (row.mode !== "draft") return notADraft(env, scope, messageId);
  const envelope = agentOperatorEnvelopeSchema.parse(JSON.parse(row.envelope));

  const noteId = `note_discord_${interaction.interactionId}`;
  const needle = `${APPROVAL_MARKER}{"draft":"${messageId}"`;
  const earlier = await env.DB.prepare(
    "SELECT id,author_name,created_at,text FROM internal_note WHERE thread_id=? AND inbox_id=? AND author_kind='operator' AND kind='steer' AND instr(text,?)>0 ORDER BY ordering_key DESC LIMIT 1",
  )
    .bind(scope.threadId, scope.inboxId, needle)
    .first<{ id: string; author_name: string; created_at: number; text: string }>();
  const earlierLanguage = () => {
    const line = earlier!.text.split("\n").find((l) => l.startsWith(`\`${APPROVAL_MARKER}`));
    return line === undefined
      ? "customer"
      : (JSON.parse(line.slice(APPROVAL_MARKER.length + 1, -1)) as DraftApproval).language;
  };
  if (earlier?.id === noteId) return handedBackText(earlierLanguage());

  const sent = await env.DB.prepare(
    "SELECT accepted_at FROM message WHERE id=? AND customer_availability='available'",
  )
    .bind(messageId)
    .first<{ accepted_at: number }>();
  if (sent)
    return `That draft was already approved and sent to the customer (${when(sent.accepted_at)}). Use /reply to send a correction.`;
  if (row.status === "approved")
    return "That draft was already approved and is on its way to the customer. Check the thread in a minute.";
  if (row.status === "rejected")
    return "That draft was rejected and never sent. Ask the agent for a new one with /agent, or answer with /reply.";
  if (earlier)
    return `${earlier.author_name} already handed this draft to the agent (${when(earlier.created_at)}): ${nextStep(earlierLanguage())}`;
  if (row.status !== "pending")
    return "That draft is out of date: the conversation moved on after it was written, so it can no longer be approved. Ask the agent for a new draft with /agent, or answer with /reply.";

  let language = translate === "off" ? "en" : translate;
  if (language === "customer") {
    const thread = await env.DB.prepare("SELECT customer_language FROM thread WHERE id=?")
      .bind(scope.threadId)
      .first<{ customer_language: string | null }>();
    language = thread?.customer_language ?? "customer";
  }
  if (language !== "customer" && new Intl.Locale(language).language === "en") language = "en";
  const approval: DraftApproval = {
    draft: messageId,
    language,
    sha256: await sha256Hex(envelope.originalText),
    by: interaction.operatorUserId,
  };
  const chunk = await env.DB.prepare(
    "SELECT discord_message_id FROM agent_draft_chunk WHERE message_id=? AND chunk_index=0",
  )
    .bind(messageId)
    .first<{ discord_message_id: string }>();
  const link = chunk
    ? `https://discord.com/channels/${interaction.guildId}/${interaction.discordThreadId}/${chunk.discord_message_id}`
    : "";
  const text = draftApprovalNote(approval, envelope.originalText, link);
  const canonical = JSON.stringify({
    threadId: scope.threadId,
    operatorUserId: interaction.operatorUserId,
    approval,
  });
  const now = Date.now();
  // Only while the draft is pending: the note's trigger then stales it in the same statement.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO internal_note(id,workspace_id,inbox_id,thread_id,author_kind,author_name,operator_discord_user_id,kind,text,interaction_id,request_json,created_at)
      SELECT ?,workspace_id,inbox_id,thread_id,'operator',?,?,'steer',?,?,?,? FROM agent_reply
      WHERE message_id=? AND thread_id=? AND inbox_id=? AND status='pending'
      ON CONFLICT(interaction_id) DO NOTHING`).bind(
      noteId,
      interaction.operatorName || interaction.operatorUserId,
      interaction.operatorUserId,
      text,
      interaction.interactionId,
      canonical,
      now,
      messageId,
      scope.threadId,
      scope.inboxId,
    ),
    // A language the operator names is the customer's language from now on.
    ...(translate === "customer" || translate === "off"
      ? []
      : [
          env.DB.prepare(
            "UPDATE thread SET customer_language=?, customer_language_updated_at=? WHERE id=? AND inbox_id=? AND EXISTS (SELECT 1 FROM internal_note WHERE id=?)",
          ).bind(language, now, scope.threadId, scope.inboxId, noteId),
        ]),
  ]);
  const note = await env.DB.prepare("SELECT * FROM internal_note WHERE interaction_id=?")
    .bind(interaction.interactionId)
    .first<InternalNote>();
  if (!note)
    return "That draft changed meanwhile (a new message, reply or note arrived). Nothing was handed to the agent; ask it for a new draft with /agent.";
  if (note.request_json !== canonical) return "This interaction belongs to a different note.";
  // The draft's workflow waits for a decision: wake it so it sees the draft is stale and ends.
  try {
    const old = await env.MESSAGE_WORKFLOW.get(envelope.workflowInstanceId);
    const state = await old.status();
    if (!["complete", "errored", "terminated"].includes(state.status))
      await old.sendEvent({ type: "agent-decision", payload: {} });
  } catch (error) {
    console.error("approve: could not end the handed-back draft's workflow", error);
  }
  await deliverNote(env, note);
  return handedBackText(language);
}

/**
 * /approve id:<draft> translate:<customer | language | off>: hands the draft to the
 * agent (handBackAgentDraft). The default language is the customer's.
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
  return handBackAgentDraft(
    env,
    interaction,
    {
      workspaceId: authorized.integration.workspaceId,
      inboxId: authorized.integration.inboxId,
      threadId: authorized.thread.threadId,
    },
    interaction.draft.trim(),
    interaction.translate ?? "customer",
  );
}
