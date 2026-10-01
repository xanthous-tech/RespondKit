CREATE TABLE thread_email_route (
  token TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES thread(id),
  recipient TEXT NOT NULL,
  UNIQUE(thread_id, recipient)
);
CREATE TABLE email_delivery (
  message_id TEXT PRIMARY KEY,
  route_token TEXT NOT NULL REFERENCES thread_email_route(token),
  sender TEXT NOT NULL,
  reply_to TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'sent', 'unknown')),
  provider_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX email_delivery_status_idx ON email_delivery(status, updated_at);
CREATE TABLE email_ingress (
  id TEXT PRIMARY KEY,
  envelope TEXT NOT NULL
);
