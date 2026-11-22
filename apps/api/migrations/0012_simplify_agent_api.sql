DROP TRIGGER IF EXISTS invalidate_agent_drafts;
DROP TRIGGER IF EXISTS invalidate_closed_agent_drafts;
DROP TRIGGER IF EXISTS authorize_agent_ingress;
DROP TRIGGER IF EXISTS authorize_agent_draft_publish;
DROP TRIGGER IF EXISTS agent_timeline_message;
DROP TRIGGER IF EXISTS agent_timeline_note;

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

ALTER TABLE thread DROP COLUMN claimed_by;
ALTER TABLE thread DROP COLUMN claim_expires_at;
