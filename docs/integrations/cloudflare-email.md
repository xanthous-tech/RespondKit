# Thread email with Cloudflare Email Service

Operator replies are also emailed when the thread owner has an email and the inbox is enabled. The body is the same customer-visible text (including approved translations). Customers can reply to that email; their plain-text reply enters the existing thread and Discord workflow. No separate email conversation is created. Browser and native polling see these messages normally.

## Setup

1. Apply D1 migrations, including `0004_thread_email.sql`, in your target environment.
2. Onboard and verify a sending domain in Cloudflare Email Service. Arbitrary customer recipients need Email Sending access; the legacy verified-destination-only Email Routing binding is insufficient.
3. Add `"send_email": [{ "name": "EMAIL" }]` to the target Wrangler environment.
4. Set `EMAIL_INBOXES` to a JSON map, for example `{"inbox_example_public":{"from":"support@example.com","replyDomain":"reply.example.com","name":"Example Support"}}`.
5. Enable Email Routing on the reply domain and route its catch-all to this Worker. Retain the existing once-per-minute scheduled trigger, which drains up to 25 pending emails per run.

Configuration is deliberately absent from checked-in live environments. Setting it enables email for new published replies, not historical replies. Removing an inbox from the map pauses its queued deliveries and inbound routing. Never expose `thread_email_route.token` or full reply addresses in public logs: they authorize email ingress for the associated recipient and conversation.

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
