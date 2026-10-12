ALTER TABLE message ADD COLUMN author_kind TEXT CHECK(author_kind IN ('operator','agent','email'));
ALTER TABLE message ADD COLUMN author_name TEXT;
UPDATE message SET author_kind='operator' WHERE direction='operator_to_customer';
UPDATE message SET author_kind='email', author_name=(SELECT json_extract(envelope,'$.email.sender') FROM email_ingress WHERE id=message.id)
WHERE id IN (SELECT id FROM email_ingress WHERE json_extract(envelope,'$.source')='email');
ALTER TABLE thread ADD COLUMN claimed_by TEXT;
ALTER TABLE thread ADD COLUMN claim_expires_at INTEGER;
CREATE TABLE agent_reply (
 message_id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL,
 inbox_id TEXT NOT NULL,
 thread_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 request_json TEXT NOT NULL,
 envelope TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('send','draft')),
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','stale')),
 basis_row_id INTEGER NOT NULL,
 decided_by TEXT,
 decided_at INTEGER,
 created_at INTEGER NOT NULL,
 FOREIGN KEY(thread_id,workspace_id,inbox_id) REFERENCES thread(id,workspace_id,inbox_id),
 UNIQUE(inbox_id,idempotency_key)
);
CREATE INDEX agent_reply_thread ON agent_reply(thread_id,status);
CREATE TABLE agent_rate_limit (
 token_hash TEXT PRIMARY KEY,
 window INTEGER NOT NULL,
 count INTEGER NOT NULL
);
CREATE TRIGGER invalidate_agent_drafts AFTER INSERT ON message
BEGIN
 UPDATE agent_reply SET status='stale'
 WHERE thread_id=NEW.thread_id AND mode='draft' AND status IN ('pending','approved')
 AND message_id<>NEW.id AND basis_row_id<NEW.row_id
 AND NOT EXISTS (SELECT 1 FROM message WHERE id=agent_reply.message_id AND customer_availability='available');
END;
CREATE TRIGGER invalidate_closed_agent_drafts AFTER UPDATE OF status ON thread
WHEN NEW.status='closed'
BEGIN
 UPDATE agent_reply SET status='stale'
 WHERE thread_id=NEW.id AND mode='draft' AND status IN ('pending','approved')
 AND NOT EXISTS (SELECT 1 FROM message WHERE id=agent_reply.message_id AND customer_availability='available');
END;
CREATE TRIGGER authorize_agent_ingress BEFORE INSERT ON message
WHEN NEW.author_kind='agent' AND NOT EXISTS (SELECT 1 FROM message WHERE id=NEW.id)
BEGIN
 SELECT RAISE(ABORT,'Agent reply is not authorized') WHERE NOT EXISTS (
  SELECT 1 FROM agent_reply r JOIN thread t ON t.id=r.thread_id
  WHERE r.message_id=NEW.id AND r.status='approved' AND t.status='open'
  AND r.workspace_id=NEW.workspace_id AND r.inbox_id=NEW.inbox_id AND r.thread_id=NEW.thread_id
 );
END;

CREATE TRIGGER authorize_agent_draft_publish BEFORE UPDATE OF customer_availability ON message
WHEN NEW.author_kind='agent' AND NEW.customer_availability='available' AND OLD.customer_availability<>'available'
AND EXISTS (SELECT 1 FROM agent_reply WHERE message_id=NEW.id AND mode='draft')
BEGIN
 SELECT RAISE(ABORT,'Agent draft is stale') WHERE NOT EXISTS (
  SELECT 1 FROM agent_reply r JOIN thread t ON t.id=r.thread_id
  WHERE r.message_id=NEW.id AND r.status='approved' AND t.status='open'
 );
END;
