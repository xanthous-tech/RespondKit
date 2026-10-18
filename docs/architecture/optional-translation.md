# Optional message translation

This supersedes the mandatory-translation flows in `base-v1.md`. Incoming messages are saved and projected in their original language. New `/reply` commands send exactly the entered text unless the operator requests translation. A Gemini outage does not affect either path.

## Operator commands

| Action | Behavior |
| --- | --- |
| `/reply message:<text>` | Send as written, without calling Gemini. |
| `/reply message:<text> translate:hi` | Translate into an explicit language (a name such as Burmese works too). The thread remembers it as the customer's language. |
| `/reply message:<text> translate:customer` | Translate into the thread's customer language. |
| `/approve id:<draft link or ID> translate:<customer \| language \| off>` | Hand an agent draft back to the agent, which translates and sends it (see below). |
| Message menu → Apps → **Approve draft** | The same as `/approve` on that draft with the default language, `customer`. |
| Message menu → Apps → **Translate to English** | Translate that exact customer message and post the English as a reply to it. |

`translate:off` is equivalent to omitting the option. `customer` never falls back to browser locale. It uses the language last named in `/reply` or `/approve` for this thread, or else a reliably detected one; if neither exists, name the language. Detection, including **Translate to English**, only fills a thread whose language is unknown: it never replaces a language an operator named, or an earlier detected one. The original reply text, requested mode, and resolved language are persisted before workflow acceptance. `/retry` cannot choose a different language.

**Translate to English** works on any original customer message RespondKit posted in the current support thread; selecting any chunk maps to the whole message. Repeated requests reuse the saved translation and do not post it twice. The private answer links the posted translation, or says why there is none. There is no `/translate` slash command.

## Approving an agent draft

An agent draft is one plain message marked "Draft, not sent", with the English text and, when the agent asked for one, a translation preview. Approving it never sends anything from RespondKit. `/approve`, **Approve draft** and the Approve buttons on drafts posted before drafts lost their buttons all follow one rule:

1. RespondKit records the approval as an operator steer note on the thread and posts it in Discord. Its second line is the machine line `` `approve:{"draft":"msg_agent_…","language":"es","sha256":"…","by":"<operator ID>"}` ``, and the English text follows verbatim. `language` is a code (`en` sends the English as written), or `customer` when the thread's language is unknown and the agent must infer it from the conversation. `sha256` is the English text's hash.
2. The note stales the draft (as any operator note does), so no other button or command can publish it, and it wakes the agent.
3. The agent translates the approved English (for example with Gemini, through its own tooling), sends it with translation off, and posts both versions as a note in the thread.

The ephemeral answer says exactly that, for example: "Handed to the agent: it will translate this reply into Spanish (es), send it, and post both versions here." A named language (not `customer` or `off`) becomes the thread's customer language. Approving a draft that was already handed back, rejected, or sent, a reply that was already sent, or a customer message answers so and records nothing. A draft that went stale because the conversation moved on cannot be approved; ask the agent for a new one with `/agent`, or answer with `/reply`. There is no Reject draft command: use `/agent` to steer or `/reply` to answer instead.

The agent's own approval (`POST /v1/agent/threads/:id/replies/:messageId/approve`, used when the operator leaves a draft untapped) still publishes the draft as drafted.

## Results and errors

Translations are separate, shared Discord replies to the original post message, with mentions suppressed. The original remains unchanged. Repeated requests reuse the stored result and publication; same-language requests do not add a duplicate post. Translation, message delivery, and translation publication have independent state. A publication failure retries posting the saved result rather than regenerating it.

Incoming translation errors are private to the operator. Jobs retain a bounded error code and provider HTTP status; no raw provider response, prompt, credentials, or Discord interaction token is logged or stored as diagnostics. A job failure never changes the original message's delivery status.

Explicit outgoing translation fails closed. If a result needs review, the customer receives nothing until an authorized operator clicks **Send this translation** in the private preview. Large previews include the full text as a private attachment. A pending review expires after one day. `/status reference:<original interaction ID>` restores the preview after the first interaction expires. Approval is bound to the message's processing generation, so old buttons cannot approve a retry's new translation. Duplicate approvals do not send duplicate replies.

Translation commands immediately defer privately. The existing HTTP interaction endpoint validates signatures and all actions recheck application, guild, forum, thread and operator permissions. Background notification is bounded to ten seconds; durable workflows continue independently. If a result takes longer, running **Translate to English** again checks or retries incoming work and `/status` checks an outgoing reply. Interaction credentials are kept only in request memory. No Gateway connection or privileged Message Content intent is needed.

## Implementation

- `packages/translation`: provider adapter, language detection, bounded context, structured results and protected-text handling.
- `apps/api/src/translation-service.ts`: inbox capability checks, scope-bound jobs, cached results and the agent adapter.
- `TranslationWorkflow`: generation and publication modes, with independent workflow IDs. Cached results survive workflow retention. Publication reuses recorded per-chunk IDs and the existing Discord nonce reconciliation.
- `translation_job`, `translation_post`: enrichment state and Discord projections, used by **Translate to English** and the agent adapter below. `translation_selection` holds the selections of the removed `/translate` command.
- `reply_review`: generation-bound outgoing approval, without exposing drafts to customer transcript polling.
- `message.reply_translation` and `reply_translation_request`: frozen resolved language/mode and original command option. Null retains legacy automatic-translation semantics for already accepted outgoing envelopes.

No general-purpose plugin loader or external agent runtime is introduced. Translation is an optional inbox capability using the existing Worker, D1, Gemini adapter and Discord app.

An agent host can register `createTranslationTool(env, authorizedScope)` from `apps/api/src/translation-service.ts`. The host supplies an already-authorized workspace/inbox/thread scope; never derive it from model arguments. The tool accepts `message_id`, `target_language`, and optional `retry`. It returns the durable translation ID, status and result. Call again to poll; `retry:true` explicitly retries a failed job. It cannot send customer replies or post to Discord. This is a server-side adapter, not a new unauthenticated HTTP endpoint or a deployed Pi integration.

## Rollout

1. Apply the additive D1 migration before deploying the Worker: `pnpm db:migrate:staging`. Existing message text and translation records are preserved. In-flight outgoing envelopes without the new fields retain their previous behavior; incoming workflow replays now project the original text.
2. In `apps/api/wrangler.jsonc`, set `env.staging.vars.TRANSLATION_ENABLED_INBOXES` to a JSON string such as `"[\"inbox_captioner_public\"]"`. Staging enables the RespondKit test and Captioner inboxes; local development defaults to `"[]"` (disabled). Keep the existing `GEMINI_API_KEY` secret and a model available to that key. Local development uses `.dev.vars`. No new secret is required.
3. Deploy with `pnpm deploy:staging`; Wrangler provisions the new `respondkit-translation-staging` workflow binding. Then run `pnpm discord:commands:apply --dry-run`, followed by `pnpm discord:commands:apply` with the existing Discord credentials and topology. Registration bulk-overwrites this app's guild commands: `/agent`, `/approve`, **Approve draft**, `/reply`, `/status`, `/retry`, **Translate to English** and `/activity`. Commands no longer in the list (`/translate`, **Reject draft**) disappear.
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
2. Use **Apps → Translate to English** on the customer message. Expect one English translation replying to the original and a private link to it; running it again posts nothing new. An English message produces only a private acknowledgment.
3. Send `/reply message:Please try again.` and verify the customer sees exactly that text. Send `/reply message:Please try again. translate:hi` and verify the customer sees the translated text. In a new thread, `translate:customer` must ask for an explicit language; after `translate:hi` it should use Hindi.
4. Have the agent post a draft, then run `/approve id:<draft link> translate:Spanish`. Expect the private answer "Handed to the agent: it will translate this reply into Spanish (es), send it, and post both versions here.", an operator note with the `approve:` line, and, once the agent runs, one Spanish reply and a note with both versions. **Approve draft** on the same draft must answer that it was already handed back.
5. Exercise a review-required translation. Use `/status` to restore its private preview, confirm it, and verify one customer reply. Check that an unauthorized operator and a stale review button cannot approve it. Automated tests deterministically force this condition; live model responses may not flag a particular phrase.
6. With an invalid development Gemini key, request an incoming translation and an explicitly translated reply. The first leaves the original available; the second sends nothing. Inspect `translation_job.error_code` and `provider_status`. Restore the key and retry; cached translations and delivered replies must not duplicate.

Automated tests cover provider rejection diagnostics, provider outages, direct delivery without a model call, scope checks, immutable selection, caching/publication, same-language behavior, browser-locale rejection, explicit reply translation, and generation-bound review authorization. Live Discord client rendering and a credential-backed Gemini success need the test-inbox smoke check above.
