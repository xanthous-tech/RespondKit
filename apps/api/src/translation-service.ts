import { normalizeTranslationLanguage } from "@respondkit/discord";
import { TRANSLATION_PROMPT_VERSION, type TranslationResult } from "@respondkit/translation";
import type { Env } from "./env";

export interface TranslationScope {
  readonly workspaceId: string;
  readonly inboxId: string;
  readonly threadId: string;
}

export interface TranslationJob {
  id: string;
  workspace_id: string;
  inbox_id: string;
  thread_id: string;
  message_id: string;
  target_language: string;
  generation: number;
  status: "pending" | "succeeded" | "failed";
  result_json: string | null;
  error_code: string | null;
  provider_status: number | null;
}

export interface TranslationWorkflowParams {
  readonly jobId: string;
  readonly generation: number;
  readonly mode: "translate" | "publish";
}

export function translationEnabled(env: Env, inboxId: string): boolean {
  try {
    const enabled: unknown = JSON.parse(env.TRANSLATION_ENABLED_INBOXES ?? "[]");
    return Array.isArray(enabled) && enabled.includes(inboxId);
  } catch {
    return false;
  }
}

export function requireTranslationEnabled(env: Env, inboxId: string) {
  if (!translationEnabled(env, inboxId))
    throw new Error(
      "Translation is not enabled for this inbox. Messages can still be sent as written.",
    );
}

export async function getTranslationJob(env: Env, scope: TranslationScope, id: string) {
  return env.DB.prepare(
    "SELECT * FROM translation_job WHERE id = ? AND workspace_id = ? AND inbox_id = ? AND thread_id = ?",
  )
    .bind(id, scope.workspaceId, scope.inboxId, scope.threadId)
    .first<TranslationJob>();
}

export function translationResult(job: TranslationJob): TranslationResult | null {
  return job.result_json === null ? null : (JSON.parse(job.result_json) as TranslationResult);
}

/** Trusted server entry point: the caller must bind an authorized scope, never accept it from tool arguments. */
export async function requestMessageTranslation(
  env: Env,
  scope: TranslationScope,
  messageId: string,
  target: string,
  retryFailed = true,
) {
  requireTranslationEnabled(env, scope.inboxId);
  const targetLanguage = normalizeTranslationLanguage(target);
  const message = await env.DB.prepare(
    "SELECT id FROM message WHERE id = ? AND workspace_id = ? AND inbox_id = ? AND thread_id = ? AND direction = 'customer_to_operator'",
  )
    .bind(messageId, scope.workspaceId, scope.inboxId, scope.threadId)
    .first();
  if (!message) throw new Error("Select a customer message in this support thread.");
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify([messageId, targetLanguage, TRANSLATION_PROMPT_VERSION]),
      ),
    ),
  );
  const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare(
    "INSERT INTO translation_job (id, workspace_id, inbox_id, thread_id, message_id, target_language, prompt_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
  )
    .bind(
      id,
      scope.workspaceId,
      scope.inboxId,
      scope.threadId,
      messageId,
      targetLanguage,
      TRANSLATION_PROMPT_VERSION,
      Date.now(),
      Date.now(),
    )
    .run();
  let job = await getTranslationJob(env, scope, id);
  if (!job) throw new Error("Translation job could not be loaded.");
  if (job.status === "failed" && retryFailed) {
    // Compare generation: concurrent retry requests converge on one attempt.
    await env.DB.prepare(
      "UPDATE translation_job SET status = 'pending', generation = generation + 1, error_code = NULL, provider_status = NULL, updated_at = ? WHERE id = ? AND generation = ? AND status = 'failed'",
    )
      .bind(Date.now(), id, job.generation)
      .run();
    job = (await getTranslationJob(env, scope, id)) ?? job;
  }
  if (job.status === "pending") await startTranslationWorkflow(env, job, "translate");
  return job;
}

export async function startTranslationWorkflow(
  env: Env,
  job: TranslationJob,
  mode: TranslationWorkflowParams["mode"],
) {
  const id = `${mode === "translate" ? "tr" : "tp"}_${job.id}_${job.generation}`;
  const params = { jobId: job.id, generation: job.generation, mode };
  let state: InstanceStatus | undefined;
  try {
    const existing = await env.TRANSLATION_WORKFLOW.get(id);
    state = await existing.status();
  } catch {
    // No retained instance: createBatch is idempotent if another request wins the race.
  }
  if (state === undefined) await env.TRANSLATION_WORKFLOW.createBatch([{ id, params }]);
  const instance = await env.TRANSLATION_WORKFLOW.get(id);
  state = await instance.status();
  // Recovery for terminated jobs and publication-only failures, without changing text.
  if (state.status === "errored" || state.status === "terminated") await instance.restart();
}

/** Adapter for an agent host with an already-authorized inbox/thread capability. No send or Discord side effect. */
export function createTranslationTool(env: Env, scope: TranslationScope) {
  return {
    name: "translate_message",
    description:
      "Translate a customer message in the current support thread. Call again to retrieve a pending result. Does not send a reply or post to Discord.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["message_id", "target_language"],
      properties: {
        retry: { type: "boolean", description: "Retry a failed translation (default false)" },
        message_id: { type: "string" },
        target_language: { type: "string" },
      },
    } as const,
    async execute(input: { message_id: string; target_language: string; retry?: boolean }) {
      const job = await requestMessageTranslation(
        env,
        scope,
        input.message_id,
        input.target_language,
        input.retry ?? false,
      );
      return {
        translation_id: job.id,
        status: job.status,
        ...translationResult(job),
        error_code: job.error_code,
      };
    },
  };
}
