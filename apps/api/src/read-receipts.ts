import {
  DiscordRestClient,
  DiscordRestError,
  pendingDiscordReadReactions,
  recordDiscordReadReaction,
} from "@respondkit/discord";
import type { ThreadId } from "@respondkit/protocol";
import { createDatabase } from "./db";
import type { Env } from "./env";

/** Persist failures for the next scheduled sweep; a Discord outage cannot lose a read. */
export async function syncDiscordReadReceipts(env: Env, threadId?: ThreadId) {
  const db = createDatabase(env.DB);
  const client = new DiscordRestClient({
    botToken: env.DISCORD_BOT_TOKEN,
    baseUrl: env.DISCORD_API_BASE_URL,
  });
  for (const { projection } of await pendingDiscordReadReactions(db, threadId)) {
    if (!projection.discordMessageId) continue;
    try {
      await client.addReadReaction(projection.discordThreadId, projection.discordMessageId);
      await recordDiscordReadReaction(db, projection, { readReactionAt: new Date() });
    } catch (error) {
      const restError = error instanceof DiscordRestError ? error : undefined;
      await recordDiscordReadReaction(db, projection, {
        readReactionRetryAt: new Date(
          Date.now() +
            Math.max(
              restError?.retryAfterMs ?? 60_000,
              restError?.retryable === false ? 3_600_000 : 60_000,
            ),
        ),
      });
      console.warn("Discord read receipt delayed", {
        messageId: projection.messageId,
        status: restError?.status,
      });
      if (restError?.status === 429) break;
    }
  }
}
