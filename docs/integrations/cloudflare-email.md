# Thread email with Cloudflare Email Service

Operator replies still unread after ten minutes (configurable per inbox) are emailed when the thread owner has an email and the inbox is enabled. The body is the same customer-visible text (including approved translations). Customers can reply to that email; their plain-text reply enters the existing thread and Discord workflow. No separate email conversation is created. Browser and native polling see these messages normally.

## Setup

1. Apply D1 migrations, including `0006_email_schedule.sql`, in your target environment.
2. Onboard and verify a sending domain in Cloudflare Email Service. Arbitrary customer recipients need Email Sending access; the legacy verified-destination-only Email Routing binding is insufficient.
3. Add `"send_email": [{ "name": "EMAIL" }]` to the target Wrangler environment.
4. Add `email` to each site/app inbox in your topology configuration: `{"from":"support@example.com","replyDomain":"reply.example.com","name":"Example Support","unreadDelaySeconds":600}`. Apply with `config:apply`. Omit `email` to disable delivery. The sending domain must be verified with Cloudflare.
5. Enable Email Routing on the reply domain and route its catch-all to this Worker. Retain the existing once-per-minute scheduled trigger, which drains up to 25 overdue thread/recipient groups per run.

Email configuration lives in D1 alongside the inbox's other settings. Removing `email` pauses pending deliveries and disables inbound routing. Existing `EMAIL_INBOXES` deployments must migrate settings into the topology file. Deadlines are snapshotted at publication and are not reset by configuration changes or enqueue retries. A ten-minute delay normally means delivery at ten to eleven minutes, later during backlog/outages.

Each read acknowledgement atomically cancels pending emails through a D1 trigger. The scheduled sender checks again immediately before provider handoff; accepted emails cannot be recalled. Only overdue unread messages are batched, in transcript order. Newer messages keep their original deadlines. Changing the customer's contact suppresses pending delivery to the old address. Reply addresses authorize ingress for their associated recipient and must not be exposed in public logs.

## Delivery and recovery

`email_delivery` snapshots recipient route, sender, reply address, subject, and text. It has one row per canonical operator message. Concurrent scheduled runs atomically claim rows. `sent` means Cloudflare accepted the message, not that the recipient read or received it.

Cloudflare's Workers sending API has no documented idempotency key. A thrown send or interrupted send therefore becomes `unknown` (stale `sending` after ten minutes). It is **not automatically retried**, preventing duplicate mail after ambiguous provider acceptance. Inspect Email Service logs and the `email_delivery` row before explicitly resetting a confirmed-unsent row to `pending`. Provider IDs are retained for successful sends. Chat delivery remains available independently.

Inbound mail requires the opaque reply token, matching envelope/header sender, matching configured reply domain, and an open thread. The token proves access to the reply address; it does not promote the email to verified account identity. Duplicate Message-IDs reuse the first immutable payload and workflow ID. Worker acceptance failures throw for Cloudflare retry. Once accepted, failed message processing uses the existing Discord `/retry` flow.

Automated replies, closed-thread replies, attachments, HTML-only bodies, missing Message-IDs, and messages over 256 KB or 6,000 text characters are rejected with an explicit SMTP reason. Quoted text is retained rather than heuristically deleting part of a customer's request. This first version handles text messages only, matching the chat clients.

## Validation

`pnpm --dir apps/api test src/email.test.ts` exercises D1 migrations, outbox deduplication, ambiguous sends, missing addresses, inbound routing, immutable redelivery, wrong senders, and loop rejection. Before enabling for customers, send a staging operator reply to a mailbox you control, reply from that mailbox, and verify the text appears in both Discord and the in-app transcript. These live DNS/provider checks require configured Email Service access.

References: [Workers sending API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [Email Service](https://developers.cloudflare.com/email-service/).

## Collecting contact addresses

React, SwiftUI, and Compose show an email text input when no address was supplied by the host or restored from the server. Saving uses authenticated `POST /v1/client/contact` with `{email, threadId?}`; `GET /v1/client/contact` restores the current visitor's contact. The optional thread ID is ownership-checked and also updates that thread owner's contact, covering account history restored on another device. Contact changes never verify an account or create chat messages. Input remains available after a save error, and customers can chat without completing the email prompt.
