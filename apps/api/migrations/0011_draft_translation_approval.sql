DROP TRIGGER agent_timeline_note;
CREATE TRIGGER agent_timeline_note AFTER INSERT ON internal_note
BEGIN
 INSERT INTO agent_timeline(workspace_id,inbox_id,thread_id,note_id,author_kind,created_at)
 VALUES (NEW.workspace_id,NEW.inbox_id,NEW.thread_id,NEW.id,NEW.author_kind,NEW.created_at);
 UPDATE internal_note SET ordering_key=(SELECT sequence FROM agent_timeline WHERE note_id=NEW.id) WHERE id=NEW.id;
 UPDATE agent_reply SET status='stale'
 WHERE NEW.author_kind='operator' AND thread_id=NEW.thread_id AND mode='draft' AND status='pending'
 AND NOT EXISTS (SELECT 1 FROM message WHERE id=agent_reply.message_id AND customer_availability='available');
END;

CREATE TABLE agent_draft_preview (
 message_id TEXT PRIMARY KEY REFERENCES agent_reply(message_id),
 result_json TEXT NOT NULL,
 posted_at INTEGER,
 confirmed_by TEXT
);
