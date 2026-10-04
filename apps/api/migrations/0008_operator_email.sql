-- Raw mail and HTML stay private in R2; the token grants download-only access.
CREATE TABLE email_source (
 message_id TEXT PRIMARY KEY,
 raw_key TEXT NOT NULL,
 html_key TEXT,
 download_token TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL
);
CREATE TABLE operator_email_route (
 token TEXT PRIMARY KEY,
 thread_id TEXT NOT NULL REFERENCES thread(id),
 config_json TEXT NOT NULL,
 UNIQUE(thread_id,config_json)
);
CREATE TABLE operator_email_delivery (
 message_id TEXT PRIMARY KEY REFERENCES message(id),
 config_json TEXT NOT NULL,
 route_token TEXT REFERENCES operator_email_route(token),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','unknown','cancelled')),
 provider_id TEXT,
 updated_at INTEGER NOT NULL
);
CREATE INDEX operator_email_pending ON operator_email_delivery(status,updated_at);
-- The notification is committed with ingress, independently of Discord projection.
CREATE TRIGGER queue_operator_email AFTER INSERT ON message
WHEN NEW.direction='customer_to_operator'
BEGIN
 INSERT INTO operator_email_delivery(message_id,config_json,updated_at)
 SELECT NEW.id,i.email_config,NEW.accepted_at FROM inbox i
 WHERE i.id=NEW.inbox_id AND i.status='active'
 AND json_type(i.email_config,'$.operator')='object';
END;
