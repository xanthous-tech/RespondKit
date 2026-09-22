import {
  createDiscordNonce,
  resolveAuthorizedDiscordThread,
  type ParsedDiscordActivityInteraction,
} from "@respondkit/discord";
import {
  ActivityError,
  activityConnection,
  fetchActivity,
  formatActivity,
} from "./activity-service";
import { createDatabase } from "./db";
import { updatePrivateInteraction } from "./discord-translation";
import type { Env } from "./env";
import { discordInteractionAcceptedAt } from "./identity";

/** Read-only enrichment: no message/workflow state, interaction token, or analytics rows are persisted. */
export async function handleActivityInteraction(
  env: Env,
  interaction: ParsedDiscordActivityInteraction,
) {
  try {
    if (
      interaction.applicationId !== env.DISCORD_APPLICATION_ID ||
      interaction.threadType !== 11 ||
      !interaction.forumChannelId
    )
      throw new ActivityError("Use /activity in an authorized support thread.");
    const authorized = await resolveAuthorizedDiscordThread(createDatabase(env.DB), {
      ...interaction,
      forumChannelId: interaction.forumChannelId,
    });
    if (!authorized.ok)
      throw new ActivityError("This command is not authorized in the current support thread.");
    const { workspaceId, inboxId } = authorized.integration;
    const connection = activityConnection(env, inboxId);
    const apiKey = env[`POSTHOG_API_KEY_${inboxId}`];
    if (!apiKey?.trim())
      throw new ActivityError("The PostHog credential is missing for this inbox.");
    const visitor = await env.DB.prepare(
      "SELECT v.posthog_distinct_id, v.timezone FROM thread t JOIN visitor v ON v.id = t.visitor_id AND v.workspace_id = t.workspace_id AND v.inbox_id = t.inbox_id WHERE t.id = ? AND t.workspace_id = ? AND t.inbox_id = ?",
    )
      .bind(authorized.thread.threadId, workspaceId, inboxId)
      .first<{ posthog_distinct_id: string | null; timezone: string | null }>();
    if (!visitor?.posthog_distinct_id?.trim())
      throw new ActivityError(
        "This customer has no PostHog distinct ID. The host app must supply one.",
      );
    // Freeze now to the command's snowflake, including Discord redeliveries.
    let end = discordInteractionAcceptedAt(interaction.interactionId).getTime();
    if (interaction.until === "last_message") {
      const message = await env.DB.prepare(
        "SELECT accepted_at FROM message WHERE workspace_id = ? AND inbox_id = ? AND thread_id = ? AND direction = 'customer_to_operator' AND accepted_at <= ? ORDER BY accepted_at DESC, row_id DESC LIMIT 1",
      )
        .bind(workspaceId, inboxId, authorized.thread.threadId, end)
        .first<{ accepted_at: number }>();
      if (!message)
        throw new ActivityError(
          "There is no customer message to anchor this window. Use until:now.",
        );
      end = message.accepted_at;
    }
    const result = await fetchActivity({
      connection,
      apiKey,
      distinctId: visitor.posthog_distinct_id,
      options: interaction,
      end,
    });
    const formatted = formatActivity(
      result,
      visitor.posthog_distinct_id,
      visitor.timezone,
      `${connection.host}/project/${connection.projectId}/activity/explore`,
    );
    const payload = {
      content: formatted.content,
      allowed_mentions: { parse: [] },
      nonce: createDiscordNonce(`activity:${interaction.interactionId}`, 0),
      enforce_nonce: true,
      ...(formatted.file ? { attachments: [{ id: 0, filename: "customer-activity.txt" }] } : {}),
    };
    let posted: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const form = new FormData();
      form.set("payload_json", JSON.stringify(payload));
      if (formatted.file)
        form.set(
          "files[0]",
          new Blob([formatted.file], { type: "text/plain" }),
          "customer-activity.txt",
        );
      posted = await fetch(
        `${env.DISCORD_API_BASE_URL}/channels/${interaction.discordThreadId}/messages`,
        {
          method: "POST",
          headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
          body: form,
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (posted.status !== 429 || attempt === 1) break;
      const rate = (await posted.json()) as { retry_after?: number };
      if (typeof rate.retry_after !== "number" || rate.retry_after < 0 || rate.retry_after > 1)
        break;
      await new Promise((resolve) => setTimeout(resolve, Math.ceil(rate.retry_after! * 1000)));
    }
    if (!posted?.ok)
      throw new ActivityError(
        `Activity was fetched, but Discord could not post it (HTTP ${posted?.status ?? "unknown"}).${formatted.file ? " Check Send Messages in Threads and Attach Files permissions." : " Check Send Messages in Threads permission."} Run /activity again to retry.`,
      );
    const message = (await posted.json()) as { id?: string };
    if (!message.id || !/^\d{1,32}$/.test(message.id))
      throw new ActivityError(
        "Discord did not confirm the activity post. Check the thread before retrying.",
      );
    await updatePrivateInteraction(env, interaction, {
      content: `Activity posted: https://discord.com/channels/${interaction.guildId}/${interaction.discordThreadId}/${message.id}`,
    });
  } catch (error) {
    await updatePrivateInteraction(env, interaction, {
      content:
        error instanceof ActivityError
          ? error.message
          : "Activity could not be fetched or posted. Check the thread before running /activity again.",
    }).catch(() => undefined);
  }
}
