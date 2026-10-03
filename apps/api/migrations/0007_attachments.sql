ALTER TABLE message ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
CREATE TABLE attachment (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL,
 inbox_id TEXT NOT NULL,
 visitor_id TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE,
 download_token TEXT NOT NULL UNIQUE,
 download_url TEXT NOT NULL,
 name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL,
 upload_id TEXT NOT NULL, part_size INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','ready','aborted')),
 message_id TEXT,
 FOREIGN KEY(visitor_id,workspace_id,inbox_id) REFERENCES visitor(id,workspace_id,inbox_id)
);
CREATE TABLE attachment_part (
 attachment_id TEXT NOT NULL REFERENCES attachment(id),
 part_number INTEGER NOT NULL, etag TEXT NOT NULL,
 PRIMARY KEY(attachment_id,part_number)
);
CREATE TABLE customer_attachment_ingress (
 message_id TEXT PRIMARY KEY,
 envelope TEXT NOT NULL
);
