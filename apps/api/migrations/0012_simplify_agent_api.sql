DROP TRIGGER IF EXISTS invalidate_agent_drafts;
DROP TRIGGER IF EXISTS invalidate_closed_agent_drafts;
DROP TRIGGER IF EXISTS authorize_agent_ingress;
DROP TRIGGER IF EXISTS authorize_agent_draft_publish;
DROP TRIGGER IF EXISTS agent_timeline_message;
DROP TRIGGER IF EXISTS agent_timeline_note;

UPDATE message SET row_id = -row_id;

UPDATE message
SET row_id = coalesce(
  (SELECT sequence FROM agent_timeline WHERE message_id = message.id),
  abs(row_id) + coalesce((SELECT max(sequence) FROM agent_timeline), 0)
);

INSERT INTO message(
  row_id,
  id,
  workspace_id,
  inbox_id,
  thread_id,
  workflow_instance_id,
  direction,
  original_text,
  accepted_at
)
SELECT
  (SELECT max(sequence) FROM agent_timeline),
  '__rk15_cursor_bump__',
  workspace_id,
  inbox_id,
  id,
  '__rk15_cursor_bump__',
  'operator_to_customer',
  'x',
  0
FROM thread
WHERE coalesce((SELECT max(sequence) FROM agent_timeline), 0) > coalesce((SELECT max(row_id) FROM message), 0)
LIMIT 1;

DELETE FROM message WHERE id = '__rk15_cursor_bump__';

DROP TABLE IF EXISTS agent_draft_preview;
DROP TABLE IF EXISTS agent_draft_chunk;
DROP TABLE IF EXISTS agent_timeline;
DROP TABLE IF EXISTS agent_ack;
DROP TABLE IF EXISTS internal_note;

CREATE TABLE agent_reply_next (
  message_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  inbox_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_json TEXT NOT NULL,
  envelope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(thread_id, workspace_id, inbox_id) REFERENCES thread(id, workspace_id, inbox_id),
  UNIQUE(inbox_id, idempotency_key)
);

INSERT INTO agent_reply_next(
  message_id,
  workspace_id,
  inbox_id,
  thread_id,
  idempotency_key,
  request_json,
  envelope,
  created_at
)
SELECT
  message_id,
  workspace_id,
  inbox_id,
  thread_id,
  idempotency_key,
  json_object(
    'threadId', thread_id,
    'text', coalesce(json_extract(request_json, '$.text'), json_extract(envelope, '$.originalText')),
    'translate', coalesce(json_extract(request_json, '$.translate'), json_extract(envelope, '$.replyTranslationRequest'), 'off')
  ),
  json_remove(envelope, '$.agent.mode', '$.agent.previewTranslation'),
  created_at
FROM agent_reply
WHERE status = 'approved';

DROP TABLE agent_reply;
ALTER TABLE agent_reply_next RENAME TO agent_reply;

CREATE TABLE discord_interaction_next (
  integration_id TEXT NOT NULL,
  interaction_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  inbox_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  discord_thread_id TEXT NOT NULL,
  operator_user_id TEXT NOT NULL,
  operator_role_ids TEXT DEFAULT '[]' NOT NULL,
  command_name TEXT NOT NULL,
  normalized_message TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch() * 1000) NOT NULL,
  PRIMARY KEY(integration_id, interaction_id),
  FOREIGN KEY (integration_id, workspace_id, inbox_id) REFERENCES discord_integration(id, workspace_id, inbox_id) ON UPDATE NO ACTION ON DELETE CASCADE,
  FOREIGN KEY (thread_id, workspace_id, inbox_id) REFERENCES thread(id, workspace_id, inbox_id) ON UPDATE NO ACTION ON DELETE CASCADE,
  FOREIGN KEY (thread_id, workspace_id, inbox_id, integration_id, discord_thread_id) REFERENCES discord_thread(thread_id, workspace_id, inbox_id, integration_id, discord_thread_id) ON UPDATE NO ACTION ON DELETE CASCADE,
  FOREIGN KEY (message_id, workspace_id, inbox_id, thread_id) REFERENCES message(id, workspace_id, inbox_id, thread_id) ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "discord_interaction_command_ck" CHECK("command_name" = 'reply'),
  CONSTRAINT "discord_interaction_id_ck" CHECK(length("interaction_id") between 1 and 32),
  CONSTRAINT "discord_interaction_external_scope_ck" CHECK(
    length("application_id") between 1 and 32
    and length("guild_id") between 1 and 32
    and length("discord_thread_id") between 1 and 32
    and length("operator_user_id") between 1 and 32
  ),
  CONSTRAINT "discord_interaction_message_text_ck" CHECK(length("normalized_message") between 1 and 6000),
  CONSTRAINT "discord_interaction_roles_json_ck" CHECK(json_valid("operator_role_ids"))
);

INSERT INTO discord_interaction_next(
  integration_id,
  interaction_id,
  workspace_id,
  inbox_id,
  thread_id,
  message_id,
  application_id,
  guild_id,
  discord_thread_id,
  operator_user_id,
  operator_role_ids,
  command_name,
  normalized_message,
  accepted_at,
  created_at
)
SELECT
  integration_id,
  interaction_id,
  workspace_id,
  inbox_id,
  thread_id,
  message_id,
  application_id,
  guild_id,
  discord_thread_id,
  operator_user_id,
  operator_role_ids,
  command_name,
  normalized_message,
  accepted_at,
  created_at
FROM discord_interaction
WHERE command_name = 'reply'
  AND message_id IS NOT NULL
  AND normalized_message IS NOT NULL;

DROP TABLE discord_interaction;
ALTER TABLE discord_interaction_next RENAME TO discord_interaction;
CREATE UNIQUE INDEX discord_interaction_message_uq ON discord_interaction (message_id);
CREATE INDEX discord_interaction_thread_idx ON discord_interaction (workspace_id, thread_id, accepted_at);

ALTER TABLE thread DROP COLUMN claimed_by;
ALTER TABLE thread DROP COLUMN claim_expires_at;
