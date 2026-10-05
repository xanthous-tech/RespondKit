# Thread email with Cloudflare Email Service

Customers and operators can reply by email into the same RespondKit thread. Operator replies appear in every client as written. If the customer supplied an email and has not read the reply after ten minutes, RespondKit sends the usual cancellable follow-up. Customer messages can also notify a configured operator mailbox, independently of Discord.

## Configuration and deployment

Apply migrations through `0008_operator_email.sql` before deploying this API. It adds `email_source`, `operator_email_route`, and `operator_email_delivery`, plus a trigger that queues operator notification in the same transaction as customer message persistence. No old messages are backfilled.

Add these bindings/variables to the **target Wrangler environment**, preserving its existing variables:

```json
{
  "send_email": [{ "name": "EMAIL" }],
  "r2_buckets": [{ "binding": "ATTACHMENTS", "bucket_name": "your-private-bucket" }],
  "vars": { "PUBLIC_API_URL": "https://api.example.com" },
  "triggers": { "crons": ["* * * * *"] }
}
```

`PUBLIC_API_URL` is the HTTPS API origin used for file downloads when no HTTP request exists. The bucket is private; do not enable public R2 access or add completed-object lifecycle expiration. The same bucket serves client uploads and email originals/files.

Onboard the From domain in Cloudflare Email Service and enable Email Sending for arbitrary customer recipients. The legacy verified-destination-only binding is insufficient. Enable Email Routing on the reply domain and route its catch-all to this Worker, preserving unrelated exact-address routes. The receiver handles only known `reply+<token>` and `operator+<token>` addresses; unrelated mail is rejected.

Configure each inbox in the topology file and apply with `config:apply`:

```json
{
  "email": {
    "from": "support@example.com",
    "name": "Example Support",
    "replyDomain": "replies.example.com",
    "unreadDelaySeconds": 600,
    "operator": {
      "forwardTo": "support-team@example.net",
      "allowedReplyFrom": ["owner@example.net"]
    }
  }
}
```

`forwardTo` is a single explicit destination. `allowedReplyFrom` lists actual sending mailboxes, including any aliases operators send from. Both envelope sender and From header must match the same allowlisted address. For an alias forwarding to Gmail, list the Gmail address if that is where replies originate. There is no inferred `chat@` destination or dependency on Simple Inbox. The customer-facing From, operator destination, and reply domain are independent.

Omit `operator` to keep customer email enabled without operator mailbox notifications. Removing/changing operator settings cancels pending notifications using the old configuration and disables replies through routes whose configuration no longer matches. Restoring identical settings makes matching routes valid again. Removing all `email` settings pauses customer delivery and disables inbound routing. Keep operator destinations separate from the catch-all receiver to avoid a forwarding loop.

## Operator notifications and replies

Each new customer message, from a client or email, queues one operator notification. The once-per-minute sender processes up to 25 pending messages per run. There is no intentional delay; backlog/outages can delay delivery. Discord projection failures do not prevent these notifications.

Notifications use the configured From and `Reply-To: operator+<opaque-token>@<replyDomain>`. Subsequent notifications use the previous provider Message-ID in `In-Reply-To` and `References` to group the operator mailbox conversation. Tokens, not subjects or caller-supplied thread IDs, select the canonical thread. Inbound To/Cc/Reply-To headers never select outbound recipients.

An authorized operator reply has a first-class email workflow identity; it does not fabricate a Discord interaction. It publishes the plain-text preview and MIME attachments into the existing customer transcript, mirrors the preview/files and original-email download links into Discord, and queues the ordinary unread customer email. No translation/Discord approval is required. A customer without an email can still receive the reply in-app.

The opaque operator reply address is a bearer capability. Matching sender checks are additional restrictions, not independent proof of account ownership or DMARC verification. Cloudflare performs its routing authentication checks; this code does not trust caller-supplied Authentication-Results headers. Treat reply addresses and archive links as private. Operator reply addresses are redacted from customer previews, and raw operator-email archives are not included in the customer transcript or customer follow-up mail.

## Customer follow-up and cancellation

The default delay is 600 seconds from publication. With the minute cron, normal delivery is at ten to eleven minutes; outages/backlog can extend it. Deadlines are snapshotted and never reset by enqueue retries. Only overdue unread replies are batched, in transcript order; newer messages keep their deadlines. Customer follow-ups contain the customer-visible text and file download links.

Each read acknowledgement atomically cancels pending emails through a D1 trigger. Dispatch rechecks reads, message availability and current customer address immediately before provider handoff. Mail already accepted by the provider cannot be recalled. Changing the customer's contact suppresses mail to the old address and disables replies using the old contact's route.

## HTML, originals and files

`postal-mime` parses the canonical first-stored MIME. R2 retains the original `.eml` bytes, decoded `.html`, and every attachment/inline-image part. HTML is not converted to Markdown and links are not rewritten for Google Drive or any other service. HTML-only mail gets a generic visible-text preview, with entities decoded and script/style content excluded. Plain-text alternatives are preferred. Quoted text is retained. Previews longer than 6,000 characters are explicitly marked as truncated; the complete original remains available to operators.

Discord cannot render arbitrary HTML. Its projection includes non-expiring capability download links to the original email and HTML, alongside the plain preview and file links. These routes force `Content-Disposition: attachment`, `application/octet-stream`, `nosniff`, a sandbox CSP and `no-store`; they never serve active HTML inline on the API origin.

Operator notifications preserve the customer email's HTML body and append original/file links. For outbound MIME headroom, HTML above 1 MiB is sent as the text preview plus full-original links instead. Inline-image parts are linked individually and remain embedded in the downloadable `.eml`; CID images are not reconstructed in the newly composed notification. Every client receives regular shared attachment metadata for inbound customer/operator files. Original operator `.eml`/`.html` archives remain separate from those customer-visible attachments.

There is no product attachment size limit or expiration. Email delivery still has provider limits (currently 25 MiB inbound, 5 MiB outbound to arbitrary recipients, 25 MiB outbound to verified destinations). Link-based files avoid outbound MIME attachment limits. Larger files can use the existing [client upload flow](attachments.md). Download links are capabilities: anyone with a link can access the object.

## Deduplication and recovery

Inbound mail requires a valid role-specific route, current inbox settings, matching sender, an open thread and Message-ID. Automated/list mail, unknown routes, wrong senders and closed threads are rejected with an SMTP reason. Storage/workflow acceptance failures throw for provider retry. Raw MIME is stored before parsing and before workflow dispatch. Duplicate Message-IDs on a route reuse the first stored MIME, file IDs, immutable envelope and deterministic workflow ID, including concurrent deliveries.

`email_delivery` tracks customer sends; `operator_email_delivery` tracks operator sends. Concurrent cron runs claim pending rows atomically. Operator claims also serialize provider handoff per route. `sent` means provider acceptance, not inbox receipt or reading. A thrown provider call or `sending` row older than ten minutes becomes `unknown`, without automatic resending. Inspect Cloudflare Email Service logs and the stored provider ID before resetting a confirmed-unsent row to `pending`; reconcile unknown sends before retrying to avoid duplicate mail.

For an accepted email workflow that later fails, inspect its `workflow_instance_id` in `email_ingress`/`message` and the Cloudflare Workflows dashboard. Restart the original failed instance after fixing the cause; never manufacture a new message ID to recover the same mail. The existing Discord `/retry` command uses Discord interaction references and does not accept email message IDs. A failed Discord audit does not retract a published operator reply or its queued follow-up.

## Validation and rollout

Run `pnpm --filter @respondkit/api exec vp test run --config vitest.config.ts src/email.test.ts src/operator-email.test.ts`. Tests exercise migrations, independent notification, configuration revocation, duplicate/concurrent mail, binary files, HTML archives/download headers, large previews, provider ambiguity, real workflow publication and read cancellation.

Before enabling customer inboxes, use controlled mailboxes for an app → operator mailbox → operator reply → app → unread customer mail → customer reply round trip. Include HTML links, binary/inline files, a user without email and a read-before-deadline cancellation. Verify live sender identity and provider threading with the actual forwarding setup. These DNS/provider checks are separate from local tests.

References: [Routing Workers API](https://developers.cloudflare.com/email-routing/email-workers/runtime-api/), [Sending Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [headers](https://developers.cloudflare.com/email-service/reference/headers/), [limits](https://developers.cloudflare.com/email-service/platform/limits/), [routing authentication](https://developers.cloudflare.com/email-service/reference/postmaster/).

## Collecting contact addresses

React, React Native, SwiftUI and Compose prompt when no address was supplied by the host or restored from the server. Authenticated `POST /v1/client/contact` accepts `{email, threadId?}`; `GET /v1/client/contact` restores the contact. The optional thread is ownership-checked. Contact changes never verify an account or create messages. Customers can chat without completing the prompt.
