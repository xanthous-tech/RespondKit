import {
  resolveAuthorizedDiscordThread,
  type ParsedDiscordCommandInteraction,
  type ParsedDiscordTranslateInteraction,
} from "@respondkit/discord";
import type { TranslationResult } from "@respondkit/translation";
import type { Env } from "./env";
import { createDatabase } from "./db";
import {
  getTranslationJob,
  requestMessageTranslation,
  startTranslationWorkflow,
  translationResult,
  type TranslationScope,
} from "./translation-service";

export interface PrivateReply {
  content: string;
  components?: unknown[];
  file?: string;
}

/** Interaction credentials are used only in memory, never saved in D1 or workflow parameters. */
export async function updatePrivateInteraction(
  env: Env,
  interaction: { applicationId: string; token: string },
  reply: PrivateReply,
) {
  const payload = {
    content: reply.content,
    components: reply.components ?? [],
    allowed_mentions: { parse: [] },
    attachments: reply.file === undefined ? [] : [{ id: 0, filename: "translation.txt" }],
  };
  let body: BodyInit;
  const headers: Record<string, string> = {};
  if (reply.file === undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(payload);
  } else {
    const form = new FormData();
    form.set("payload_json", JSON.stringify(payload));
    form.set("files[0]", new Blob([reply.file], { type: "text/plain" }), "translation.txt");
    body = form;
  }
  const response = await fetch(
    `${env.DISCORD_API_BASE_URL}/webhooks/${interaction.applicationId}/${encodeURIComponent(interaction.token)}/messages/@original`,
    { method: "PATCH", headers, body },
  );
  if (!response.ok) throw new Error(`Discord private response failed (${response.status})`);
}

export async function resolveTranslationMessage(
  env: Env,
  scope: TranslationScope,
  interaction: ParsedDiscordTranslateInteraction,
) {
  let discordMessageId = interaction.targetMessageId;
  if (interaction.messageLink !== undefined) {
    const match =
      /^https:\/\/(?:www\.)?discord(?:app)?\.com\/channels\/(\d{1,32})\/(\d{1,32})\/(\d{1,32})$/.exec(
        interaction.messageLink,
      );
    if (!match || match[1] !== interaction.guildId || match[2] !== interaction.discordThreadId)
      throw new Error("Choose a Discord message link from this support thread.");
    discordMessageId = match[3];
  }
  if (discordMessageId !== undefined) {
    const row = await env.DB.prepare(
      "SELECT m.id FROM message m JOIN discord_message dm ON dm.message_id = m.id AND dm.workspace_id = m.workspace_id AND dm.inbox_id = m.inbox_id AND dm.thread_id = m.thread_id WHERE m.workspace_id = ? AND m.inbox_id = ? AND m.thread_id = ? AND m.direction = 'customer_to_operator' AND dm.discord_message_id = ? AND dm.discord_thread_id = ? AND dm.projection_kind IN ('customer_projection', 'failure_audit')",
    )
      .bind(
        scope.workspaceId,
        scope.inboxId,
        scope.threadId,
        discordMessageId,
        interaction.discordThreadId,
      )
      .first<{ id: string }>();
    if (!row)
      throw new Error("Select an original customer message posted by RespondKit in this thread.");
    return row.id;
  }
  const row = await env.DB.prepare(
    "SELECT id FROM message WHERE workspace_id = ? AND inbox_id = ? AND thread_id = ? AND direction = 'customer_to_operator' ORDER BY accepted_at DESC, id DESC LIMIT 1",
  )
    .bind(scope.workspaceId, scope.inboxId, scope.threadId)
    .first<{ id: string }>();
  if (!row) throw new Error("This thread has no customer messages.");
  return row.id;
}

export async function handleTranslationInteraction(
  env: Env,
  interaction: ParsedDiscordCommandInteraction,
) {
  try {
    if (interaction.threadType !== 11 || interaction.forumChannelId === undefined)
      throw new Error("Use this action in a support thread.");
    const authorized = await resolveAuthorizedDiscordThread(createDatabase(env.DB), {
      applicationId: interaction.applicationId,
      guildId: interaction.guildId,
      forumChannelId: interaction.forumChannelId,
      discordThreadId: interaction.discordThreadId,
      operatorUserId: interaction.operatorUserId,
      operatorRoleIds: interaction.operatorRoleIds,
    });
    if (!authorized.ok)
      throw new Error("This action is not authorized in the current support thread.");
    const scope = {
      workspaceId: authorized.integration.workspaceId,
      inboxId: authorized.integration.inboxId,
      threadId: authorized.thread.threadId,
    };
    if (interaction.command === "confirm_translation") {
      const message = await env.DB.prepare(
        "SELECT m.id, m.workflow_instance_id, m.processing_generation FROM message m JOIN discord_interaction di ON di.message_id = m.id JOIN reply_review rr ON rr.message_id = m.id AND rr.generation = m.processing_generation WHERE di.interaction_id = ? AND di.integration_id = ? AND m.workspace_id = ? AND m.inbox_id = ? AND m.thread_id = ? AND m.processing_generation = ? AND m.processing_status IN ('processing', 'retrying') AND m.customer_availability = 'pending'",
      )
        .bind(
          interaction.reference,
          authorized.integration.id,
          scope.workspaceId,
          scope.inboxId,
          scope.threadId,
          interaction.generation,
        )
        .first<{ id: string; workflow_instance_id: string; processing_generation: number }>();
      if (!message)
        throw new Error(
          "This preview is no longer awaiting confirmation. Check /status before sending another reply.",
        );
      await env.DB.prepare(
        "UPDATE reply_review SET confirmed_by = coalesce(confirmed_by, ?) WHERE message_id = ? AND generation = ?",
      )
        .bind(interaction.operatorUserId, message.id, interaction.generation)
        .run();
      const workflow = await env.MESSAGE_WORKFLOW.get(message.workflow_instance_id);
      await workflow.sendEvent({
        type: `translation-approved-${message.processing_generation}`,
        payload: {},
      });
      await updatePrivateInteraction(env, interaction, {
        content: `Translation approved; delivery is pending. Use /status reference:${interaction.reference} to check.`,
      });
      return;
    }
    if (interaction.command !== "translate") return;
    const messageId = await freezeTranslationSelection(env, scope, interaction);
    const job = await requestMessageTranslation(env, scope, messageId, interaction.targetLanguage);
    await startTranslationWorkflow(env, job, "publish");
    // Bounded notification only; the durable job and its publication outlive this request.
    for (let attempt = 0; attempt < 10; attempt++) {
      const current = await getTranslationJob(env, scope, job.id);
      if (current?.status === "failed") {
        await updatePrivateInteraction(env, interaction, {
          content: `Translation unavailable (${current.error_code ?? "unknown"}${current.provider_status === null ? "" : `, HTTP ${current.provider_status}`}). The original message is available. Run /translate again to retry.`,
        });
        return;
      }
      if (current?.status === "succeeded") {
        const result = translationResult(current);
        if (
          result &&
          new Intl.Locale(result.sourceLanguage).language ===
            new Intl.Locale(result.targetLanguage).language
        ) {
          await updatePrivateInteraction(env, interaction, {
            content: `This message is already in ${result.targetLanguage}. No duplicate was posted.`,
          });
          return;
        }
        const post = await env.DB.prepare(
          "SELECT discord_message_id FROM translation_post WHERE job_id = ? AND chunk_index = 0",
        )
          .bind(job.id)
          .first<{ discord_message_id: string }>();
        const publication = await env.TRANSLATION_WORKFLOW.get(`tp_${job.id}_${job.generation}`);
        const publicationState = await publication.status();
        if (publicationState.status === "errored" || publicationState.status === "terminated") {
          await updatePrivateInteraction(env, interaction, {
            content:
              "Translation is saved, but posting it to Discord failed. Run /translate again to retry posting.",
          });
          return;
        }
        if (post && publicationState.status === "complete") {
          await updatePrivateInteraction(env, interaction, {
            content: `Translation: https://discord.com/channels/${interaction.guildId}/${interaction.discordThreadId}/${post.discord_message_id}`,
          });
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    await updatePrivateInteraction(env, interaction, {
      content:
        "Translation is still being prepared or posted. The result will appear as a reply to the original message. Run the same command again to check or retry publication.",
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Translation unavailable. The original message is available.";
    await updatePrivateInteraction(env, interaction, { content: message.slice(0, 1800) }).catch(
      () => undefined,
    );
  }
}

export async function replyReview(
  env: Env,
  messageId: string,
  reference: string,
): Promise<PrivateReply | null> {
  const row = await env.DB.prepare(
    "SELECT rr.generation, rr.result_json FROM reply_review rr JOIN message m ON m.id = rr.message_id AND m.processing_generation = rr.generation WHERE rr.message_id = ? AND m.customer_availability = 'pending' AND m.processing_status IN ('processing', 'retrying')",
  )
    .bind(messageId)
    .first<{ generation: number; result_json: string }>();
  if (!row) return null;
  const result = JSON.parse(row.result_json) as TranslationResult;
  return {
    content: `**Review required · reply not sent**\nTarget language: ${result.targetLanguage}\n${result.translatedText.length > 1500 ? "Read the complete translation in the attached file before confirming." : result.translatedText}\n\nReference: ${reference}`,
    ...(result.translatedText.length > 1500 ? { file: result.translatedText } : {}),
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "Send this translation",
            custom_id: `confirm-translation:${reference}:${row.generation}`,
          },
        ],
      },
    ],
  };
}

export async function notifyReplyProgress(
  env: Env,
  interaction: { applicationId: string; token: string },
  messageId: string,
  reference: string,
) {
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      const review = await replyReview(env, messageId, reference);
      if (review) {
        await updatePrivateInteraction(env, interaction, review);
        return;
      }
      const message = await env.DB.prepare(
        "SELECT customer_availability, processing_status FROM message WHERE id = ?",
      )
        .bind(messageId)
        .first<{ customer_availability: string; processing_status: string }>();
      if (message?.customer_availability === "available") {
        await updatePrivateInteraction(env, interaction, {
          content: `Reply available in chat. Reference: ${reference}`,
        });
        return;
      }
      if (message?.processing_status === "failed") {
        await updatePrivateInteraction(env, interaction, {
          content: `Reply not sent—translation or publication failed. Use /status reference:${reference}.`,
        });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    await updatePrivateInteraction(env, interaction, {
      content: `Reply is still processing. Use /status reference:${reference} to check delivery or review a translation.`,
    });
  } catch {
    // The durable reply state and /status remain available if the interaction token expires.
  }
}

export async function freezeTranslationSelection(
  env: Env,
  scope: TranslationScope,
  interaction: ParsedDiscordTranslateInteraction,
) {
  const query = () =>
    env.DB.prepare(
      "SELECT message_id, target_language FROM translation_selection WHERE interaction_id = ? AND workspace_id = ? AND inbox_id = ? AND thread_id = ?",
    )
      .bind(interaction.interactionId, scope.workspaceId, scope.inboxId, scope.threadId)
      .first<{ message_id: string; target_language: string }>();
  const existing = await query();
  if (existing) {
    if (existing.target_language !== interaction.targetLanguage)
      throw new Error("This interaction already selected another language.");
    return existing.message_id;
  }
  const selected = await resolveTranslationMessage(env, scope, interaction);
  await env.DB.prepare(
    "INSERT INTO translation_selection (interaction_id, workspace_id, inbox_id, thread_id, message_id, target_language) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
  )
    .bind(
      interaction.interactionId,
      scope.workspaceId,
      scope.inboxId,
      scope.threadId,
      selected,
      interaction.targetLanguage,
    )
    .run();
  const canonical = await query();
  if (!canonical || canonical.target_language !== interaction.targetLanguage)
    throw new Error("This interaction already belongs to another translation request.");
  return canonical.message_id;
}
