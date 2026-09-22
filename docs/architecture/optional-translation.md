# Optional message translation

This supersedes the mandatory-translation flows in `base-v1.md`. Incoming messages are saved and projected in their original language. New `/reply` commands send exactly the entered text unless the operator requests translation. A Gemini outage does not affect either path.

## Operator commands

| Action | Behavior |
| --- | --- |
| Message menu → Apps → **Translate to English** | Translate that exact customer message. |
| `/translate` | Translate the latest customer message into English. |
| `/translate message:<Discord message link> to:hi` | Translate a particular customer message into Hindi. |
| `/reply message:<text>` | Send as written, without calling Gemini. |
| `/reply message:<text> translate:customer` | Translate into the latest reliably detected customer language. |
| `/reply message:<text> translate:hi` | Translate into an explicit language. |

`translate:off` is equivalent to omitting the option. `customer` never falls back to browser locale: translate a customer message first, or select an explicit language. The original reply text, requested mode, and resolved language are persisted before workflow acceptance. `/retry` cannot choose a different language.

Context-menu commands use Discord's `MESSAGE` command type and `target_id`. Slash commands do not carry a reply target; use the message link option. Only mapped customer messages in the current authorized support thread are accepted. Selecting any chunk maps to the whole original message. Existing failure-audit posts can also identify their canonical customer message. The first accepted selection is saved per interaction, so a redelivered `/translate` cannot switch to a newer message.

## Results and errors

Translations are separate, shared Discord replies to the original post message, with mentions suppressed. The original remains unchanged. Repeated requests reuse the stored result and publication; same-language requests do not add a duplicate post. Translation, message delivery, and translation publication have independent state. A publication failure retries posting the saved result rather than regenerating it.

Incoming translation errors are private to the operator. Jobs retain a bounded error code and provider HTTP status; no raw provider response, prompt, credentials, or Discord interaction token is logged or stored as diagnostics. A job failure never changes the original message's delivery status.

Explicit outgoing translation fails closed. If a result needs review, the customer receives nothing until an authorized operator clicks **Send this translation** in the private preview. Large previews include the full text as a private attachment. A pending review expires after one day. `/status reference:<original interaction ID>` restores the preview after the first interaction expires. Approval is bound to the message's processing generation, so old buttons cannot approve a retry's new translation. Duplicate approvals do not send duplicate replies.

Translation commands immediately defer privately. The existing HTTP interaction endpoint validates signatures and all actions recheck application, guild, forum, thread and operator permissions. Background notification is bounded to ten seconds; durable workflows continue independently. If a result takes longer, `/translate` checks/retries incoming work and `/status` checks an outgoing reply. Interaction credentials are kept only in request memory. No Gateway connection or privileged Message Content intent is needed.

## Implementation

- `packages/translation`: provider adapter, language detection, bounded context, structured results and protected-text handling.
- `apps/api/src/translation-service.ts`: inbox capability checks, scope-bound jobs, cached results and the agent adapter.
- `TranslationWorkflow`: generation and publication modes, with independent workflow IDs. Cached results survive workflow retention. Publication reuses recorded per-chunk IDs and the existing Discord nonce reconciliation.
- `translation_job`, `translation_post`, `translation_selection`: enrichment state, Discord projections and immutable command selections.
- `reply_review`: generation-bound outgoing approval, without exposing drafts to customer transcript polling.
- `message.reply_translation` and `reply_translation_request`: frozen resolved language/mode and original command option. Null retains legacy automatic-translation semantics for already accepted outgoing envelopes.

No general-purpose plugin loader or external agent runtime is introduced. Translation is an optional inbox capability using the existing Worker, D1, Gemini adapter and Discord app.

An agent host can register `createTranslationTool(env, authorizedScope)` from `apps/api/src/translation-service.ts`. The host supplies an already-authorized workspace/inbox/thread scope; never derive it from model arguments. The tool accepts `message_id`, `target_language`, and optional `retry`. It returns the durable translation ID, status and result. Call again to poll; `retry:true` explicitly retries a failed job. It cannot send customer replies or post to Discord. This is a server-side adapter, not a new unauthenticated HTTP endpoint or a deployed Pi integration.

## Rollout

1. Apply the additive D1 migration before deploying the Worker: `pnpm db:migrate:staging`. Existing message text and translation records are preserved. In-flight outgoing envelopes without the new fields retain their previous behavior; incoming workflow replays now project the original text.
2. In `apps/api/wrangler.jsonc`, set `env.staging.vars.TRANSLATION_ENABLED_INBOXES` to a JSON string such as `"[\"inbox_captioner_public\"]"`. Staging enables the RespondKit test and Captioner inboxes; local development defaults to `"[]"` (disabled). Keep the existing `GEMINI_API_KEY` secret and a model available to that key. Local development uses `.dev.vars`. No new secret is required.
3. Deploy with `pnpm deploy:staging`; Wrangler provisions the new `respondkit-translation-staging` workflow binding. Then run `pnpm discord:commands:apply --dry-run`, followed by `pnpm discord:commands:apply` with the existing Discord credentials and topology. Registration bulk-overwrites this app's guild commands and includes `/reply`, `/retry`, `/status`, `/translate`, and **Translate to English**.
4. In Discord **Server Settings → Integrations → RespondKit**, enable the new commands for the operator role/users. Commands default to administrator-only visibility until configured; the existing server-side operator allowlist still applies. Keep View Channel, Read Message History, Send Messages in Threads and the existing forum permissions. Allow **Attach Files** for long private review previews if absent. No new OAuth scope, bot installation, Gateway intent, or separate Discord application is required.
5. Notify operators that **plain `/reply` now sends as written**. Existing `/retry` and `/status` references continue to describe the original request. An unrecoverable reply without stored options is not reconstructed with guessed defaults.

Applying the migration, deploying, and registering commands are separate release actions. Opening this PR does not perform them. To roll back code, keep the additive tables/columns; do not undo migrations while workflows are active.

## Test checklist

Run automated checks from the repository root:

```sh
pnpm check
pnpm test:all
pnpm build:all
```

On Node 26, the existing jsdom suite conflicts with Node's global Web Storage. Use `NODE_OPTIONS=--no-experimental-webstorage pnpm test:all` on that runtime.

In a test inbox after rollout:

1. Send a Hindi, Thai, or Burmese customer message. Its original text should appear promptly with no translation or processing-failed warning. Repeat with a deliberately invalid development Gemini key: normal incoming delivery and plain `/reply` must still work.
2. Use **Apps → Translate to English**, then `/translate` on the same message. Expect one shared translation replying to the original. Test `message:<link>` against an earlier message; a link from another thread must be rejected. An English message translated to English should produce only a private acknowledgment.
3. Send `/reply message:Please try again.` and verify the customer sees exactly that text. Send `/reply message:Please try again. translate:hi` and verify the customer sees the translated text. Before any reliable language detection, `translate:customer` must ask for an explicit language; afterward it should use the detected language.
4. Exercise a review-required translation. Use `/status` to restore its private preview, confirm it, and verify one customer reply. Check that an unauthorized operator and a stale review button cannot approve it. Automated tests deterministically force this condition; live model responses may not flag a particular phrase.
5. With an invalid development Gemini key, request an incoming translation and an explicitly translated reply. The first leaves the original available; the second sends nothing. Inspect `translation_job.error_code` and `provider_status`. Restore the key and retry; cached translations and delivered replies must not duplicate.

Automated tests cover provider rejection diagnostics, provider outages, direct delivery without a model call, scope checks, immutable selection, caching/publication, same-language behavior, browser-locale rejection, explicit reply translation, and generation-bound review authorization. Live Discord client rendering and a credential-backed Gemini success need the test-inbox smoke check above.
