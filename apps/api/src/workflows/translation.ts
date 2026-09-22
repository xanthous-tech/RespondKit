import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  createGeminiTranslationModel,
  createTranslator,
  classifyTranslationError,
  type TranslationResult,
} from "@respondkit/translation";
import {
  createDiscordNonce,
  DiscordRestClient,
  DiscordRestError,
  languageDisplayName,
  splitDiscordMessage,
} from "@respondkit/discord";
import type { Env } from "../env";
import { loadMessageTranslationContext } from "@respondkit/conversations";
import { createDatabase } from "../db";
import { WorkspaceIdSchema, InboxIdSchema, ThreadIdSchema } from "@respondkit/protocol";
import {
  requireTranslationEnabled,
  translationResult,
  type TranslationJob,
  type TranslationWorkflowParams,
} from "../translation-service";

const DATABASE_STEP = {
  retries: { limit: 3, delay: "1 second", backoff: "exponential" },
  timeout: "30 seconds",
} as const;
const PROVIDER_STEP = {
  retries: { limit: 4, delay: "2 seconds", backoff: "exponential" },
  timeout: "2 minutes",
} as const;
const DISCORD_STEP = {
  retries: { limit: 5, delay: "5 seconds", backoff: "exponential" },
  timeout: "1 minute",
} as const;

export class TranslationWorkflow extends WorkflowEntrypoint<Env, TranslationWorkflowParams> {
  override async run(event: WorkflowEvent<TranslationWorkflowParams>, step: WorkflowStep) {
    const input = event.payload;
    const job = await step.do("load-job", DATABASE_STEP, async () => {
      const row = await this.env.DB.prepare(
        "SELECT * FROM translation_job WHERE id = ? AND generation = ?",
      )
        .bind(input.jobId, input.generation)
        .first<TranslationJob>();
      if (!row) throw new NonRetryableError("Translation job is missing or superseded");
      requireTranslationEnabled(this.env, row.inbox_id);
      return row;
    });
    if (input.mode === "publish") return this.publish(job, step);
    if (job.status === "succeeded") return { status: "succeeded", translationId: job.id };
    try {
      const source = await step.do("load-source", DATABASE_STEP, async () => {
        const message = await this.env.DB.prepare(
          "SELECT original_text, accepted_at FROM message WHERE id = ? AND workspace_id = ? AND inbox_id = ? AND thread_id = ? AND direction = 'customer_to_operator'",
        )
          .bind(job.message_id, job.workspace_id, job.inbox_id, job.thread_id)
          .first<{ original_text: string; accepted_at: number }>();
        if (!message) throw new NonRetryableError("Customer message is missing");
        const context = await loadMessageTranslationContext(createDatabase(this.env.DB), {
          workspaceId: WorkspaceIdSchema.parse(job.workspace_id),
          inboxId: InboxIdSchema.parse(job.inbox_id),
          threadId: ThreadIdSchema.parse(job.thread_id),
          before: new Date(message.accepted_at),
        });
        return { text: message.original_text, context };
      });
      const result = await step.do("translate-message", PROVIDER_STEP, async () => {
        try {
          return await createTranslator({
            model: createGeminiTranslationModel({
              apiKey: this.env.GEMINI_API_KEY,
              modelId: this.env.GEMINI_MODEL,
            }),
          }).translate({ ...source, targetLanguage: job.target_language });
        } catch (error) {
          const classified = classifyTranslationError(error);
          // Record only safe diagnostics, never provider response bodies or credentials.
          await this.env.DB.prepare(
            "UPDATE translation_job SET error_code = ?, provider_status = ? WHERE id = ? AND generation = ?",
          )
            .bind(classified.code, classified.statusCode ?? null, job.id, job.generation)
            .run();
          if (!classified.retryable)
            throw new NonRetryableError(
              `Translation rejected: ${classified.code}${classified.statusCode === undefined ? "" : ` (HTTP ${classified.statusCode})`}`,
            );
          throw classified;
        }
      });
      await step.do("save-translation", DATABASE_STEP, () => this.save(job, result));
      return { status: "succeeded", translationId: job.id };
    } catch (error) {
      await step.do("record-translation-failure", DATABASE_STEP, async () => {
        await this.env.DB.prepare(
          "UPDATE translation_job SET status = 'failed', error_code = coalesce(error_code, 'workflow_error'), updated_at = ? WHERE id = ? AND generation = ? AND status != 'succeeded'",
        )
          .bind(Date.now(), job.id, job.generation)
          .run();
      });
      throw error;
    }
  }

  private async save(job: TranslationJob, result: TranslationResult) {
    await this.env.DB.batch([
      this.env.DB.prepare(
        "UPDATE translation_job SET status = 'succeeded', result_json = ?, error_code = NULL, provider_status = NULL, updated_at = ? WHERE id = ? AND generation = ?",
      ).bind(JSON.stringify(result), Date.now(), job.id, job.generation),
      this.env.DB.prepare(
        "UPDATE thread SET customer_language = ?, customer_language_updated_at = (SELECT accepted_at FROM message WHERE id = ?) WHERE id = ? AND workspace_id = ? AND inbox_id = ? AND ? = 0 AND (customer_language_updated_at IS NULL OR customer_language_updated_at <= (SELECT accepted_at FROM message WHERE id = ?))",
      ).bind(
        result.sourceLanguage,
        job.message_id,
        job.thread_id,
        job.workspace_id,
        job.inbox_id,
        result.needsReview ? 1 : 0,
        job.message_id,
      ),
    ]);
    // The original message, its processing status, and its display text stay untouched.
  }

  private async publish(job: TranslationJob, step: WorkflowStep) {
    let ready = job;
    for (let attempt = 0; attempt < 30; attempt++) {
      ready = await step.do(`read-result-${attempt}`, DATABASE_STEP, async () => {
        const row = await this.env.DB.prepare("SELECT * FROM translation_job WHERE id = ?")
          .bind(job.id)
          .first<TranslationJob>();
        if (!row || row.generation !== job.generation)
          throw new NonRetryableError("Translation was superseded");
        return row;
      });
      if (ready.status !== "pending") break;
      await step.sleep(
        `wait-for-translation-${attempt}`,
        attempt === 0 ? "1 second" : attempt === 1 ? "2 seconds" : "10 seconds",
      );
    }
    if (ready.status !== "succeeded")
      throw new NonRetryableError("Translation unavailable; original message remains available");
    const result = translationResult(ready);
    if (!result) throw new NonRetryableError("Translation result is missing");
    if (
      new Intl.Locale(result.sourceLanguage).language ===
      new Intl.Locale(result.targetLanguage).language
    )
      return { status: "already_in_language" };
    const target = await step.do("load-discord-target", DATABASE_STEP, async () => {
      const row = await this.env.DB.prepare(
        "SELECT dt.discord_thread_id, dm.discord_message_id FROM discord_thread dt JOIN discord_message dm ON dm.thread_id = dt.thread_id AND dm.workspace_id = dt.workspace_id AND dm.inbox_id = dt.inbox_id WHERE dt.thread_id = ? AND dt.workspace_id = ? AND dt.inbox_id = ? AND dt.state = 'ready' AND dm.message_id = ? AND dm.status = 'sent' AND dm.projection_kind IN ('customer_projection', 'failure_audit') ORDER BY dm.chunk_index LIMIT 1",
      )
        .bind(job.thread_id, job.workspace_id, job.inbox_id, job.message_id)
        .first<{ discord_thread_id: string; discord_message_id: string }>();
      if (!row) throw new NonRetryableError("Original Discord message is unavailable");
      return row;
    });
    const content = `**${languageDisplayName(result.targetLanguage)} translation · ${languageDisplayName(result.sourceLanguage)} → ${languageDisplayName(result.targetLanguage)}**\n${result.needsReview ? "⚠️ Translation needs review.\n" : ""}${result.translatedText}`;
    const client = new DiscordRestClient({
      botToken: this.env.DISCORD_BOT_TOKEN,
      baseUrl: this.env.DISCORD_API_BASE_URL,
    });
    for (const [index, chunk] of splitDiscordMessage(content).entries()) {
      await step.do(`publish-translation-${index}`, DISCORD_STEP, async () => {
        const id = `${job.id}:${index}`;
        const existing = await this.env.DB.prepare(
          "SELECT discord_message_id FROM translation_post WHERE id = ?",
        )
          .bind(id)
          .first();
        if (existing) return;
        try {
          const sent = await client.sendMessageReconciled({
            channelId: target.discord_thread_id,
            content: chunk,
            nonce: createDiscordNonce(`translation:${job.id}`, index),
            replyToMessageId: target.discord_message_id,
          });
          await this.env.DB.prepare(
            "INSERT INTO translation_post (id, job_id, chunk_index, discord_message_id) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
          )
            .bind(id, job.id, index, sent.message.id)
            .run();
        } catch (error) {
          if (error instanceof DiscordRestError && !error.retryable)
            throw new NonRetryableError(`Discord publication rejected: ${error.status}`);
          throw error;
        }
      });
    }
    return { status: "published", translationId: job.id };
  }
}
