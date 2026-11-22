# Optional message translation

This supersedes the mandatory-translation flows in `base-v1.md`. Incoming messages are saved and projected in their original language. New `/reply` commands send the entered text unless the operator requests translation. A Gemini outage does not affect either path.

## Operator commands

| Action | Behavior |
| --- | --- |
| `/reply message:<text>` | Send as written, without calling Gemini. |
| `/reply message:<text> translate:hi` | Translate into an explicit language (a name such as Burmese works too). The thread remembers it as the customer's language. |
| `/reply message:<text> translate:customer` | Translate into the thread's customer language. |
| Message menu → Apps → **Translate to English** | Translate that customer message and post the English as a reply to it. |
| `/activity` | Show the customer's PostHog pageviews and events in the support thread. |

`translate:off` is equivalent to omitting the option. `customer` never falls back to browser locale. It uses the language last named in `/reply` for this thread, or else a reliably detected one; if neither exists, name the language. Detection, including **Translate to English**, only fills a thread whose language is unknown: it never replaces a language an operator named, or an earlier detected one.

**Translate to English** works on any original customer message RespondKit posted in the current support thread; selecting any chunk maps to the whole message. Repeated requests reuse the saved translation and do not post it twice. The private answer links the posted translation, or says why there is none.

## Results and errors

Translations are separate, shared Discord replies to the original post message, with mentions suppressed. The original remains unchanged. Repeated requests reuse the stored result and publication; same-language requests do not add a duplicate post. Translation, message delivery, and translation publication have independent state. A publication failure retries posting the saved result rather than regenerating it.

Incoming translation errors are private to the operator. Jobs retain a bounded error code and provider HTTP status; no raw provider response, prompt, credentials, or Discord interaction token is logged or stored as diagnostics. A job failure never changes the original message's delivery status.

Explicit outgoing translation fails closed. If a result needs review, the customer receives nothing until an authorized operator clicks **Send this translation** in the private preview. Large previews include the full text as a private attachment. A pending review expires after one day. Confirmation is bound to the message's processing generation. Duplicate confirmations do not send duplicate replies.

Background notification is bounded to ten seconds; durable workflows continue independently. If a reply fails before reaching the customer, the private message reports that it was not sent and the operator can send it again with `/reply`. Interaction credentials stay only in request memory. No Gateway connection or privileged Message Content intent is needed.

## Implementation

- `packages/translation`: provider adapter, language detection, bounded context, structured results and protected-text handling.
- `apps/api/src/translation-service.ts`: inbox capability checks, scope-bound jobs, and cached results.
- `TranslationWorkflow`: generation and publication modes, with independent workflow IDs. Cached results survive workflow retention. Publication reuses recorded per-chunk IDs and Discord nonce reconciliation.
- `translation_job`, `translation_post`: enrichment state and Discord projections used by **Translate to English**.
- `reply_review`: generation-bound outgoing confirmation for `/reply` translations that need review.
- `message.reply_translation` and `reply_translation_request`: frozen resolved language and original command option.

## Rollout

1. Apply the D1 migrations before deploying the Worker: `pnpm db:migrate:staging`.
2. In `apps/api/wrangler.jsonc`, set `env.staging.vars.TRANSLATION_ENABLED_INBOXES` to a JSON string such as `"[\"inbox_captioner_public\"]"`. Keep the existing `GEMINI_API_KEY` secret and a model available to that key. Local development uses `.dev.vars`.
3. Deploy with `pnpm deploy:staging`. Then run `pnpm discord:commands:apply --dry-run`, followed by `pnpm discord:commands:apply`. Registration bulk-overwrites this app's guild commands with the three operator commands: `/reply`, **Translate to English**, and `/activity`.
4. In Discord **Server Settings → Integrations → RespondKit**, enable the commands for the operator role or users. Keep View Channel, Read Message History, Send Messages in Threads, Attach Files, and forum permissions.

## Test checklist

Run automated checks from the repository root:

```sh
pnpm check
pnpm test:all
pnpm build:all
```

In a test inbox after rollout:

1. Send a Hindi, Thai, or Burmese customer message. Its original text appears without translation. Repeat with an invalid Gemini key: incoming delivery and plain `/reply` still work.
2. Use **Apps → Translate to English** on the customer message. Expect one English translation replying to the original and a private link to it; running it again posts nothing new.
3. Send `/reply message:Please try again.` and verify the customer sees that text. Send `/reply message:Please try again. translate:hi` and verify the customer sees the translated text. In a new thread, `translate:customer` asks for an explicit language; after `translate:hi` it uses Hindi.
4. Exercise a review-required translation, confirm with **Send this translation**, and verify one customer reply.
5. With an invalid Gemini key, send `/reply` with `translate:hi` (nothing reaches the customer), restore the key, and send again with `/reply` so the customer gets one message.
