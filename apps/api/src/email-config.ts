import { emailConfigurationSchema } from "@respondkit/workspaces";
import type { Env } from "./env";

export async function emailSettings(env: Env, inboxId: string) {
  const row = await env.DB.prepare(
    "SELECT email_config FROM inbox WHERE id = ? AND status = 'active'",
  )
    .bind(inboxId)
    .first<{ email_config: string | null }>();
  return row?.email_config
    ? emailConfigurationSchema.parse(JSON.parse(row.email_config))
    : undefined;
}
