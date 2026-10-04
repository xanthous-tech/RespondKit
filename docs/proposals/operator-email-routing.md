# Operator email routing

Status: proposed follow-up to 0.6.0, not implemented or deployed. This adds managing RespondKit conversations from Gmail, Simple Inbox, or another operator mailbox. It does not require a new mailbox UI or a dependency on Simple Inbox.

## Existing behavior and gaps

`apps/api/src/email.ts` already sends unread operator replies after ten minutes, cancels pending delivery when the customer reads, and accepts customer replies at an opaque `reply+<token>` address. It currently rejects HTML-only messages, attachments, and raw messages over 256 KB. The operator workflow envelope requires Discord identity; email cannot yet act as an operator source. Client attachments already use private R2 and shared attachment DTOs.

## Proposed flow

1. Persist each customer message in its canonical thread, then notify the explicitly configured operator mailbox immediately. Keep this outbox independent of Discord delivery and the customer's ten-minute timer.
2. Send a new notification with the inbox's verified From address and `Reply-To: operator+<opaque-token>@<replyDomain>`. Resolve the token to the thread and authorized operator identities; a thread ID alone is not authorization.
3. Cloudflare Email Routing delivers the operator's reply to the Worker. Validate route, current configuration, and sender; persist once and publish through a first-class email operator path into the existing transcript. Do not fabricate Discord identity fields.
4. The customer sees the reply in-app. If an email address was collected and the reply stays unread for ten minutes, use the existing cancellable customer-email path. Customers without email can still receive operator replies in-app.
5. Preserve separate operator/customer email threading using provider-returned Message-IDs and `In-Reply-To`/`References`. Reply-token routing remains authoritative if subjects or headers change. Prevent autoresponder loops, duplicate ingestion, and operator/customer notification loops.

Cloudflare's `message.forward()` permits adding only `X-*` headers, so it cannot set the required Reply-To. Use the structured `EMAIL.send()` API. Cloudflare generates Message-ID and rejects caller overrides; retain the returned provider ID for subsequent threading.

## Explicit per-inbox settings

Proposed extension to the existing `email` topology configuration:

```json
{
  "email": {
    "from": "support@example.com",
    "name": "Example Support",
    "replyDomain": "replies.example.com",
    "unreadDelaySeconds": 600,
    "operator": {
      "forwardTo": "support-team@example.net",
      "allowedReplyFrom": ["support-team@example.net"]
    }
  }
}
```

These new fields are not accepted by 0.6.0 yet. Omit `operator` to disable notifications. When enabled, require an explicit destination and sender allowlist. Never infer an address from allowed origins or supply a `chat@` fallback. A forwarding alias can deliver to Gmail while replies originate from another address; configure the actual permitted reply identity explicitly. Recheck permissions on inbound mail and invalidate old operator routes when settings change.

Keep the operator destination, customer-facing From address, and reply domain independent. Each From domain still needs Email Sending verification. An inbound email's To/Cc/Reply-To values must not authorize arbitrary relay recipients. Require role-specific opaque tokens and authenticated, permitted sender identities; do not trust a sender-supplied Authentication-Results header as proof.

For this installation, the owner chose the apex `respondkit.dev` reply domain and `chat@<app-domain>` operator destinations. A read-only live configuration audit on 2026-10-04 found:

| Inbox | Operator destination for this installation |
| --- | --- |
| `inbox_captioner_public` | `chat@captioner.io` |
| `inbox_subporter_public` | `chat@subporter.com` |

These are installation values only. `inbox_respondkit_test` has localhost origins; leave forwarding disabled until it has a deliberate test destination. Sending it to `chat@respondkit.dev` without a separate mailbox route would feed the support receiver itself.

## Original HTML and attachments

Continue with `postal-mime`, already used by RespondKit and Simple Inbox. Reuse Simple Inbox's architectural patterns for reply aliases, immutable ingestion, R2 storage, and delivery state; do not reuse its deployed resources or copy the full mail application.

- Preserve the original MIME message and its HTML part in private R2. Forward the HTML body through Email Sending rather than converting it to Markdown or rewriting links for particular services. Keep MIME attachment and inline-image content available so HTML references can be reconstructed when forwarding.
- Discord messages do not render arbitrary HTML. Post the email's plain-text alternative as a preview and attach the original email (`.eml`) and HTML part (`.html`), or provide R2 download links when Discord's attachment limits apply. The preserved original is the authoritative content; the Discord preview is not a replacement for it.
- For HTML-only mail, derive a generic plain-text preview if useful, without treating that preview as the stored or forwarded body. Do not add Google Drive-specific parsing, a Markdown representation, or service-specific URL extraction. Ordinary HTML links remain intact in the original HTML.
- Keep preview formatting from interpreting email text as Discord commands or mentions. Do not embed untrusted HTML directly in the app UI; downloads remain attachments. A future browser preview would need sanitization and an isolated sandbox, but it is outside this minimal scope.
- Preserve quoted content in the original rather than introducing mail-client-specific quote-stripping rules. A bounded preview may point to the complete original when it exceeds transcript limits; it must be clearly a preview, never a silent truncation of the authoritative email.
- Store incoming attachments in private R2 and attach the shared metadata to the canonical message. Extend operator attachment persistence as well as customer ingestion so all existing clients can display the files. Preserve filenames and inline image files.
- Include R2 download links in operator notifications and customer follow-ups. No additional product upload-size limit or lifecycle expiration is proposed. Keep bearer download links out of logs.
- Replace the current 256 KB/attachment rejection with provider-aware handling. Cloudflare's inbound limit is 25 MiB; arbitrary-recipient outbound messages are limited to 5 MiB (25 MiB for verified destinations). Link-based attachments avoid outbound MIME limits. Larger files remain supported through client uploads.
- Capture raw MIME durably before asynchronous processing. Deduplicate Message-IDs and preserve the first accepted payload; make attachment ownership and replay behavior consistent. Retain ambiguous provider sends for reconciliation instead of automatically duplicating them.

## Implementation and rollout

1. Add raw MIME/HTML preservation and R2 email attachment ingestion, with synthetic fixtures for HTML preservation through forwarding, Discord original-email downloads, multipart alternatives, ordinary links, inline images, malformed mail, duplicates, and provider limits.
2. Add optional operator configuration, role-specific routes/outbox, email operator identity/persistence, and workflow delivery. Test wrong senders, cross-inbox tokens, revoked settings, automated replies, duplicate/concurrent events, and independent email/Discord failures.
3. Preserve the current ten-minute read cancellation. Initially send operator email replies as written unless translation is explicitly selected; do not silently require approval through a Discord-only screen.
4. Inspect `respondkit.dev` DNS and routing before changes. Once receiver code and migrations are ready, route its catch-all to the RespondKit Worker, preserving unrelated exact-address rules and all Simple Inbox/app-domain routes. Add the EMAIL/private R2 bindings to the serving Wrangler environment (`staging` serves `api.respondkit.dev`) and verify each configured sender domain.
5. Apply explicit inbox settings and run a controlled app → operator mailbox → operator reply → app → unread customer email → customer reply round trip, including attachments and an HTML email with links and inline images. Verify that forwarded HTML preserves its content and the original is accessible from Discord. Verify read-before-deadline cancellation, then enable the second application inbox.

No DNS, Email Routing, inbox settings, or deployed Worker changes have been made by this proposal. SDK publication is separate from this backend follow-up.

## References

Code: RespondKit's `apps/api/src/email.ts`, `apps/api/src/workflows/envelope.ts`, `apps/api/src/workflows/message.ts`, `apps/api/src/attachments.ts`, and `packages/workspaces/src/config.ts`. Simple Inbox's `packages/mail/src/services/inbound.ts`, `mime.ts`, and `linked-attachments.ts` were inspected as references only.

- [Routing Workers API](https://developers.cloudflare.com/email-routing/email-workers/runtime-api/)
- [Sending Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
- [Email headers](https://developers.cloudflare.com/email-service/reference/headers/)
- [Provider limits](https://developers.cloudflare.com/email-service/platform/limits/)
