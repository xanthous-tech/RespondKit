# Operator email routing implementation

Implemented in PR #46 as a backend extension following 0.6.0. See the [configuration, behavior and recovery guide](../integrations/cloudflare-email.md) for the complete setup.

## Architecture

- `0008_operator_email.sql` queues an operator notification atomically with each new canonical customer message. A separate cron outbox keeps email delivery independent of Discord and the customer's ten-minute timer.
- `email-ingress.ts` validates distinct customer/operator routes and preserves immutable email identities. `email-content.ts` stores original MIME, decoded HTML and file parts in private R2, creates safe download-only links, and derives bounded plain-text previews without Markdown or link-service parsing.
- `operator-email.ts` sends to explicit per-inbox destinations, rechecks sender/configuration authorization and persists a first-class operator email message. The existing message workflow publishes it as written, mirrors originals/files to Discord and schedules normal unread email.
- All existing clients consume the same transcript and attachment metadata. No SDK release or new mailbox UI is required. The operator can use Gmail, Simple Inbox or another mailbox.

The From address, operator destination, allowed sending mailboxes and reply domain remain separate configuration fields. Addresses are never inferred from app domains. Raw operator mail is available to operators, not included as a customer-visible attachment. Reply/download links grant bearer access and must remain private.

## Installation rollout

For this installation, use the owner's chosen apex reply domain `respondkit.dev` and explicit destinations:

| Inbox | Operator destination |
| --- | --- |
| `inbox_captioner_public` | `chat@captioner.io` |
| `inbox_subporter_public` | `chat@subporter.com` |

These are installation values only, not defaults in code. Populate `allowedReplyFrom` with the actual mailbox identities used to send replies; forwarding destinations and sending identities can differ. Leave `inbox_respondkit_test` disabled until a test destination is configured deliberately.

Before activation, inspect existing apex DNS/exact-address routes, verify From domains, apply migrations and configure EMAIL, private R2 and PUBLIC_API_URL in the serving environment (`staging` serves `api.respondkit.dev`). Route the apex catch-all to the RespondKit Worker without changing Simple Inbox/app-domain routes. Run the controlled round trip described in the integration guide before enabling the second application.

This PR adds code, tests and setup documentation. It does not apply live migrations, deploy the Worker, configure inboxes or change DNS/routing.
