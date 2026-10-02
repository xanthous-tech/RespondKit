ALTER TABLE inbox ADD COLUMN email_config TEXT;
ALTER TABLE email_delivery RENAME TO email_delivery_old;
CREATE TABLE email_delivery (
 message_id TEXT PRIMARY KEY,
 route_token TEXT NOT NULL REFERENCES thread_email_route(token),
 sender TEXT NOT NULL, reply_to TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','unknown','cancelled')),
 provider_id TEXT, batch_id TEXT, updated_at INTEGER NOT NULL,
 due_at INTEGER NOT NULL, transcript_cursor INTEGER NOT NULL
);
INSERT INTO email_delivery (message_id,route_token,sender,reply_to,subject,body,status,provider_id,updated_at,due_at,transcript_cursor)
SELECT d.message_id,d.route_token,d.sender,d.reply_to,d.subject,d.body,d.status,d.provider_id,d.updated_at,
 coalesce((SELECT max(event_at) FROM customer_transcript_entry WHERE message_id=d.message_id AND event_kind='available'),d.updated_at)+600000,
 coalesce((SELECT max(row_id) FROM customer_transcript_entry WHERE message_id=d.message_id AND event_kind='available'),0)
FROM email_delivery_old d;
DROP TABLE email_delivery_old;
CREATE INDEX email_delivery_due_idx ON email_delivery(status,due_at);
CREATE INDEX email_delivery_batch_idx ON email_delivery(batch_id);
-- Reading is monotonic and cancellation is committed with the read itself, across every client.
CREATE TRIGGER cancel_read_emails AFTER UPDATE OF customer_read_cursor ON thread
BEGIN
 UPDATE email_delivery SET status='cancelled', updated_at=unixepoch()*1000
 WHERE status='pending' AND transcript_cursor<=NEW.customer_read_cursor
 AND route_token IN (SELECT token FROM thread_email_route WHERE thread_id=NEW.id);
END;
