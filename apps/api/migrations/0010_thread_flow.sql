CREATE TABLE internal_note (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL,
 inbox_id TEXT NOT NULL,
 thread_id TEXT NOT NULL,
 ordering_key INTEGER UNIQUE,
 author_kind TEXT NOT NULL CHECK(author_kind IN ('operator','agent')),
 author_name TEXT NOT NULL,
 operator_discord_user_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('reasoning','reply','steer','summary','note')),
 text TEXT NOT NULL,
 idempotency_key TEXT,
 interaction_id TEXT UNIQUE,
 request_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 discord_message_ids TEXT NOT NULL DEFAULT '[]',
 delivery_holder TEXT,
 delivery_expires_at INTEGER,
 discord_posted_at INTEGER,
 delivery_retry_at INTEGER NOT NULL DEFAULT 0,
 FOREIGN KEY(thread_id,workspace_id,inbox_id) REFERENCES thread(id,workspace_id,inbox_id),
 UNIQUE(inbox_id,idempotency_key)
);
CREATE INDEX internal_note_pending ON internal_note(discord_posted_at,delivery_retry_at);
CREATE INDEX internal_note_thread ON internal_note(thread_id,ordering_key);
CREATE TABLE agent_timeline (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 workspace_id TEXT NOT NULL,
 inbox_id TEXT NOT NULL,
 thread_id TEXT NOT NULL,
 message_id TEXT UNIQUE REFERENCES message(id),
 note_id TEXT UNIQUE REFERENCES internal_note(id),
 author_kind TEXT NOT NULL CHECK(author_kind IN ('customer','operator','agent')),
 created_at INTEGER NOT NULL,
 CHECK((message_id IS NULL) <> (note_id IS NULL)),
 FOREIGN KEY(thread_id,workspace_id,inbox_id) REFERENCES thread(id,workspace_id,inbox_id)
);
CREATE INDEX agent_timeline_thread ON agent_timeline(thread_id,sequence);
CREATE INDEX agent_timeline_wake ON agent_timeline(thread_id,author_kind,sequence);
CREATE TABLE agent_ack (
 thread_id TEXT PRIMARY KEY REFERENCES thread(id),
 through_sequence INTEGER NOT NULL DEFAULT 0 CHECK(through_sequence>=0)
);
CREATE TABLE agent_draft_chunk (
 discord_message_id TEXT PRIMARY KEY,
 discord_thread_id TEXT NOT NULL,
 message_id TEXT NOT NULL REFERENCES agent_reply(message_id),
 chunk_index INTEGER NOT NULL,
 UNIQUE(message_id,chunk_index)
);
INSERT INTO agent_timeline(workspace_id,inbox_id,thread_id,message_id,author_kind,created_at)
 SELECT workspace_id,inbox_id,thread_id,id,
 CASE WHEN direction='customer_to_operator' THEN 'customer' WHEN author_kind='agent' THEN 'agent' ELSE 'operator' END,
 accepted_at FROM message ORDER BY row_id;
CREATE TRIGGER agent_timeline_message AFTER INSERT ON message
BEGIN
 INSERT INTO agent_timeline(workspace_id,inbox_id,thread_id,message_id,author_kind,created_at)
 VALUES (NEW.workspace_id,NEW.inbox_id,NEW.thread_id,NEW.id,
 CASE WHEN NEW.direction='customer_to_operator' THEN 'customer' WHEN NEW.author_kind='agent' THEN 'agent' ELSE 'operator' END,NEW.accepted_at);
END;
CREATE TRIGGER agent_timeline_note AFTER INSERT ON internal_note
BEGIN
 INSERT INTO agent_timeline(workspace_id,inbox_id,thread_id,note_id,author_kind,created_at)
 VALUES (NEW.workspace_id,NEW.inbox_id,NEW.thread_id,NEW.id,NEW.author_kind,NEW.created_at);
 UPDATE internal_note SET ordering_key=(SELECT sequence FROM agent_timeline WHERE note_id=NEW.id) WHERE id=NEW.id;
 UPDATE agent_reply SET status='stale'
 WHERE NEW.author_kind='operator' AND thread_id=NEW.thread_id AND mode='draft' AND status IN ('pending','approved')
 AND NOT EXISTS (SELECT 1 FROM message WHERE id=agent_reply.message_id AND customer_availability='available');
END;
