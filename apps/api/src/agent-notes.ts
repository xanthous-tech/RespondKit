import {
  createDiscordNonce,
  DiscordRestClient,
  resolveAuthorizedDiscordThread,
  splitDiscordMessage,
  type ParsedDiscordAgentNoteInteraction,
} from "@respondkit/discord";
import { createDatabase } from "./db";
import type { Env } from "./env";

export interface InternalNote {
  id: string;
  workspace_id: string;
  inbox_id: string;
  thread_id: string;
  ordering_key: number;
  author_kind: "agent" | "operator";
  author_name: string;
  operator_discord_user_id: string | null;
  kind: string;
  text: string;
  request_json: string;
  created_at: number;
  discord_message_ids: string;
}

export function noteResponse(note: InternalNote) {
  return {
    id: note.id,
    workspaceId: note.workspace_id,
    inboxId: note.inbox_id,
    threadId: note.thread_id,
    sequence: String(note.ordering_key),
    authorKind: note.author_kind,
    authorName: note.author_name,
    operatorDiscordUserId: note.operator_discord_user_id,
    kind: note.kind,
    text: note.text,
    createdAt: new Date(note.created_at).toISOString(),
    discordMessageIds: JSON.parse(note.discord_message_ids) as string[],
  };
}

export async function deliverNote(env: Env, note: InternalNote): Promise<boolean> {
  const chunks = splitDiscordMessage(
    `**${note.author_kind === "agent" ? "Agent" : "Operator"} ${note.author_name}** · ${note.kind}\n${note.text}`,
  );
  let ids = JSON.parse(note.discord_message_ids) as string[];
  if (ids.length === chunks.length) {
    await env.DB.prepare(
      "UPDATE internal_note SET discord_posted_at=coalesce(discord_posted_at,?) WHERE id=?",
    )
      .bind(Date.now(), note.id)
      .run();
    return true;
  }
  const mapping = await env.DB.prepare(
    "SELECT discord_thread_id FROM discord_thread WHERE thread_id=? AND workspace_id=? AND inbox_id=? AND state='ready'",
  )
    .bind(note.thread_id, note.workspace_id, note.inbox_id)
    .first<{ discord_thread_id: string }>();
  if (!mapping) return false;
  const holder = crypto.randomUUID();
  const lease = await env.DB.prepare(
    "UPDATE internal_note SET delivery_holder=?,delivery_expires_at=? WHERE id=? AND (delivery_holder IS NULL OR delivery_expires_at<=?) RETURNING discord_message_ids",
  )
    .bind(holder, Date.now() + 120_000, note.id, Date.now())
    .first<{ discord_message_ids: string }>();
  if (!lease) return false;
  ids = JSON.parse(lease.discord_message_ids) as string[];
  const client = new DiscordRestClient({
    botToken: env.DISCORD_BOT_TOKEN,
    baseUrl: env.DISCORD_API_BASE_URL,
  });
  try {
    for (let index = ids.length; index < chunks.length; index++) {
      const result = await client.sendMessageReconciled({
        channelId: mapping.discord_thread_id,
        content: chunks[index]!,
        nonce: createDiscordNonce(`note:${note.id}`, index),
      });
      ids.push(result.message.id);
      await env.DB.prepare(
        "UPDATE internal_note SET discord_message_ids=?,delivery_expires_at=? WHERE id=? AND delivery_holder=?",
      )
        .bind(JSON.stringify(ids), Date.now() + 120_000, note.id, holder)
        .run();
    }
    await env.DB.prepare(
      "UPDATE internal_note SET discord_posted_at=? WHERE id=? AND delivery_holder=?",
    )
      .bind(Date.now(), note.id, holder)
      .run();
    return true;
  } catch {
    await env.DB.prepare(
      "UPDATE internal_note SET delivery_retry_at=? WHERE id=? AND delivery_holder=?",
    )
      .bind(Date.now() + 60_000, note.id, holder)
      .run();
    return false;
  } finally {
    note.discord_message_ids = JSON.stringify(ids);
    await env.DB.prepare(
      "UPDATE internal_note SET delivery_holder=NULL,delivery_expires_at=NULL WHERE id=? AND delivery_holder=?",
    )
      .bind(note.id, holder)
      .run();
  }
}

export async function steerAgent(
  env: Env,
  interaction: ParsedDiscordAgentNoteInteraction,
): Promise<string> {
  if (
    interaction.applicationId !== env.DISCORD_APPLICATION_ID ||
    interaction.threadType !== 11 ||
    !interaction.forumChannelId
  )
    return "This command is not authorized in the current support thread.";
  const authorized = await resolveAuthorizedDiscordThread(createDatabase(env.DB), {
    ...interaction,
    forumChannelId: interaction.forumChannelId,
  });
  if (!authorized.ok) return "This command is not authorized in the current support thread.";
  const { integration, thread } = authorized;
  const canonical = JSON.stringify({
    threadId: thread.threadId,
    operatorUserId: interaction.operatorUserId,
    text: interaction.message,
  });
  await env.DB.prepare(`INSERT INTO internal_note(id,workspace_id,inbox_id,thread_id,author_kind,author_name,operator_discord_user_id,kind,text,interaction_id,request_json,created_at)
    VALUES (?,?,?,?,'operator',?,?,'steer',?,?,?,?) ON CONFLICT(interaction_id) DO NOTHING`)
    .bind(
      `note_discord_${interaction.interactionId}`,
      integration.workspaceId,
      integration.inboxId,
      thread.threadId,
      interaction.operatorName,
      interaction.operatorUserId,
      interaction.message,
      interaction.interactionId,
      canonical,
      Date.now(),
    )
    .run();
  const note = await env.DB.prepare("SELECT * FROM internal_note WHERE interaction_id=?")
    .bind(interaction.interactionId)
    .first<InternalNote>();
  if (!note || note.request_json !== canonical)
    return "This interaction belongs to a different note.";
  const delivered = await deliverNote(env, note);
  return delivered
    ? "Steering note saved and posted. The agent can read it on its next poll."
    : "Steering note saved; the Discord echo will retry automatically.";
}

export async function deliverPendingNotes(env: Env): Promise<void> {
  const notes = await env.DB.prepare(`SELECT n.* FROM internal_note n
    JOIN discord_thread d ON d.thread_id=n.thread_id AND d.workspace_id=n.workspace_id AND d.inbox_id=n.inbox_id
    JOIN inbox i ON i.id=n.inbox_id
    WHERE n.discord_posted_at IS NULL AND n.delivery_retry_at<=? AND (n.delivery_holder IS NULL OR n.delivery_expires_at<=?)
    AND d.state='ready' AND i.status='active' ORDER BY n.delivery_retry_at,n.ordering_key LIMIT 25`)
    .bind(Date.now(), Date.now())
    .all<InternalNote>();
  for (const note of notes.results) await deliverNote(env, note);
}
