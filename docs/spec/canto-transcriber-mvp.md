# Canto Transcriber support base

Status: superseded for implementation by [Agent Chat base architecture v1](../architecture/base-v1.md); retained as the earlier Durable Object/Gateway design
Last updated: 2026-08-25
First integration: `canto-transcriber` web

> The current reviewed candidate uses Discord `/reply` interactions, D1 polling, and one Cloudflare `MessageWorkflow` per message. It has no Discord Gateway, Durable Object, Queue, Cron, or transactional outbox. Use the linked architecture as the implementation source of truth.

## Outcome

Build one complete, intentionally small support loop:

1. A visitor talks through a React widget on Canto Transcriber.
2. The Cloudflare backend durably stores threads and messages.
3. A customer message is translated into English and appears in its mapped Discord thread.
4. Simon types an ordinary English reply in Discord.
5. The reply is translated into the thread's customer language and appears in the React widget.

The base also exposes a small typed HTTP/realtime API. That is enough to replace the most painful part of Crisp and enough substrate for media, email, and a Pi extension later.

Do not put another help desk beneath this release. Once Discord is the operator application and translation is owned, a paid substrate removes too little work to justify its second data model and operational dependency.

## Absolute minimum

Included:

- one SSR-safe React customer widget;
- anonymous browser sessions;
- one active support thread per Canto browser installation;
- durable text messages and immutable original content;
- automatic incoming customer-language-to-English translation;
- automatic outgoing English-to-customer-language translation;
- one private Discord forum channel as the inbox;
- one Discord thread per support thread;
- normal human Discord replies, delivery state, deduplication, and reconnect;
- a small client/integration API and versioned event schema;
- Canto route, locale, PostHog IDs, user ID/email when available, UA, and coarse Cloudflare location as provenance-labelled context.

Deferred until this loop works:

- Pi or another AI agent;
- direct Cloudflare Queue pull from an external process;
- PostHog API access or session-replay analysis;
- attachments and screen recordings;
- email notifications/replies;
- server-signed Canto identity;
- generated support documents;
- native iOS/Android clients;
- an operator dashboard, search, assignment, metrics, billing, and public multi-tenancy.

The schemas reserve message kinds and event names for these additions, but the base does not implement empty abstractions for them.

## Customer and operator behavior

### React customer widget

- A small launcher is available across Canto marketing, docs, tools, and `/app`.
- The conversation panel lazy-loads only when opened and becomes full-height on a narrow mobile browser.
- A first send creates or resumes the installation's active thread.
- Text sends optimistically with a `client_message_id`, then shows pending, sent, or retryable failure.
- The exact original customer text remains visible in the widget and survives refresh/reconnect.
- New server messages arrive over realtime; reconnect always reconciles from the last durable sequence.
- The widget can collect an email as context, but the base must not imply that it will notify a closed browser before email delivery exists.

### Discord operator inbox

- A configured private forum channel is the Canto inbox.
- The first customer message creates one forum post/thread. IDs, not names, form the durable mapping.
- Incoming content shows the English translation first, with the original immediately available below it or in a compact secondary block.
- The thread starter shows current URL, locale, browser/device, coarse location, and allowlisted customer/PostHog identifiers with their provenance.
- Any ordinary text message from an authorized human in a mapped thread is a customer reply.
- The bot adds a pending reaction while translating, then a success/failure reaction and a compact receipt with the exact customer-facing text.
- Bot messages, webhooks, messages outside the configured inbox, and the bot's own translation receipts never loop back to the customer.
- `/language my`, `/language th`, and `/language en` override the persisted customer language. Other internal-note/agent commands are later work.

Outgoing translation fails closed: an English Discord reply is never sent untranslated to a non-English customer.

## Stable domain model

Use `thread` as the product term. A Discord thread is a projection of one support thread, not the source of truth.

| Entity | Base meaning |
| --- | --- |
| Product | Fixed Canto configuration, inbox key, translation settings, and Discord destination. |
| Installation | Opaque browser identity and session boundary. |
| Thread | One ordered support conversation for a product/installation. |
| Message | One immutable authored item with a server sequence and delivery state. |
| Translation | A derived text variant keyed by message, target language, model, and prompt version. |
| Discord mapping | Product/thread/message IDs mapped to Discord channel/thread/message IDs. |
| Delivery attempt | Idempotent connector attempt and its terminal/retryable result. |
| Context field | A value plus provenance such as server-configured, request-observed, or client-reported. |

Base messages are text, but the discriminator is forward-compatible:

```ts
type MessageKind = "text" | "attachment" | "support_document";
```

Only `text` is accepted in v0. Unknown future kinds fall back to a plain unsupported-message row rather than breaking older clients.

## Cloudflare architecture

```text
Canto React widget
  | HTTP history/send + short-lived WebSocket ticket
  v
Agent Chat Worker API
  |
  v
Thread Durable Object (ordered writes, SQLite, hibernating WebSockets)
  | transactional message + outbox
  +----------------------> D1 thread/inbox/Discord index
  v
separate Cloudflare Queues
  +--> Gemini translation consumer
  +--> Discord REST consumer

Discord Gateway bot in a small Cloudflare Container
  | normalized authorized message event
  +----------------------> Agent Chat Worker API
```

Responsibilities:

- The Worker handles session exchange, thread/message API calls, socket tickets, context normalization, translation callbacks, and Discord bot authentication.
- One Durable Object per thread owns sequence allocation, authoritative messages/translations, the transactional outbox, language state, and hibernating WebSockets.
- D1 provides the cross-thread index and Discord mappings. It is not the authority for message order.
- Separate Queues isolate translation and Discord side effects. Consumers are idempotent because Cloudflare Queues are at least once and unordered. See [delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/).
- The Discord bot needs the persistent [Gateway](https://docs.discord.com/developers/events/gateway) because ordinary thread messages are not delivered through HTTP interaction endpoints. The API remains authoritative when the Gateway reconnects.

R2 is not required until attachments arrive. Email, agent jobs, support documents, and PostHog API access are not base services.

## Simple API v1

All responses and realtime events carry `schema_version: 1`. Public inbox IDs route requests but are not credentials.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/client/sessions` | Exchange inbox key + installation credential/context for a short-lived client token. |
| `POST` | `/v1/threads` | Idempotently create or return the installation's active thread. |
| `GET` | `/v1/threads/{thread_id}` | Get thread language/state and bounded context. |
| `GET` | `/v1/threads/{thread_id}/messages?after={sequence}` | Reconcile ordered history. |
| `POST` | `/v1/threads/{thread_id}/messages` | Send a text message with `client_message_id`. |
| `POST` | `/v1/realtime/tickets` | Mint a one-use, short-lived WebSocket ticket. |
| `GET` | `/v1/realtime?ticket=...` | Upgrade to the thread realtime stream. |
| `POST` | `/v1/internal/discord/messages` | Accept one authenticated, normalized Gateway event. |
| `POST` | `/v1/internal/translations/{job_id}/complete` | Commit a translation consumer result idempotently. |

Representative client send:

```json
{
  "schema_version": 1,
  "client_message_id": "01K...",
  "kind": "text",
  "text": "...",
  "context_patch": {
    "page_url": "https://captioner.io/tools/...",
    "locale": "th-TH",
    "posthog_distinct_id": "...",
    "posthog_session_id": "..."
  }
}
```

Representative response/event:

```json
{
  "schema_version": 1,
  "type": "thread.message.created",
  "thread_id": "thr_...",
  "sequence": 12,
  "message": {
    "id": "msg_...",
    "kind": "text",
    "actor": "customer",
    "original": { "language": "th", "text": "..." },
    "operator_translation": null,
    "status": "accepted",
    "created_at": "2026-08-25T00:00:00Z"
  }
}
```

Translation completion emits `thread.message.translation_ready`; Discord/customer delivery emits `thread.message.delivery_changed`. Realtime events are hints—clients always use the sequence API after a gap.

The API intentionally does not expose arbitrary operator send, transcript export, analytics query, or agent authority through a public client token.

## Translation contract

Use Google's stable [`gemini-3.1-flash-lite`](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) through the paid Gemini Developer API. Use that exact configurable ID; the preview model has retired, and the [lifecycle table](https://ai.google.dev/gemini-api/docs/deprecations) currently schedules this stable model to retire on 2027-05-07.

Create a new Gemini authorization key, store it only as a Worker secret, and do not inherit a legacy standard key that Google says will stop working in September 2026. The paid service is appropriate for customer messages because Google says paid prompts/responses are not used to improve its products, subject to its documented abuse-monitoring retention. See [API keys](https://ai.google.dev/gemini-api/docs/api-key) and [data use/ZDR](https://ai.google.dev/gemini-api/docs/zdr).

The translator is a narrow component with no tools, URL fetching, PostHog/customer identity, source access, internal notes, or send privilege.

For every call:

1. Persist the exact original first.
2. Mask code, URLs/Markdown destinations, emails, UUIDs/hashes, file paths, CLI flags, variables, HTML tags, version strings, and glossary terms marked `preserve` with unique placeholders.
3. Send only the current message, target language, a short Canto description/glossary, and at most six recent customer-visible turns capped around 2,000 tokens.
4. Ask for schema-constrained JSON: source language, target language, translation, mixed-language/review flags, and ambiguities.
5. Require every placeholder exactly once and reject unknown placeholders before restoring the originals byte-for-byte.

Structured output guarantees JSON shape rather than semantic correctness, so application validation is mandatory. See [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/generate-content/structured-output).

Language state:

- browser locale is a hint;
- the first substantive non-English customer message establishes the conversation preference;
- a short or English message does not switch an established Burmese/Thai thread;
- the Discord `/language` override is authoritative;
- incoming English is a no-cost pass-through;
- outgoing delivery always targets the persisted/overridden customer language.

For likely legacy Burmese Zawgyi, convert only the model input to Unicode when detection confidence is high and preserve the original. Google's open [Myanmar Tools](https://github.com/google/myanmar-tools) supplies detection/conversion, although it is not an official Google product.

Use minimal thinking and leave Gemini 3 temperature at its documented default. Incoming translation may update asynchronously; outgoing translation fails closed. Retry transient `408`, `429`, and `5xx` failures with bounded jitter, and retry one invalid/safety result through a configured fallback. The source message ID deduplicates every attempt.

Current Standard pricing makes model cost secondary: 10,000 short one-way translations are roughly $4.75 at 1,000 input/150 output tokens each, or $10 at 2,500 input/250 output tokens. See [pricing](https://ai.google.dev/gemini-api/docs/pricing). Measure the actual Canto path with targets of p50 below 1.5 seconds and p95 below four seconds for short messages.

## Verified Canto integration

Canto already has a one-component global seam. In `canto-transcriber/code/apps/web/src/routes/__root.tsx`, `AnalyticsProvider` and `CrispProvider` are siblings under `<ClientOnly>`. Replace the Crisp slot:

```tsx
<ClientOnly>
  <AnalyticsProvider />
  <AgentChatProvider />
</ClientOnly>
```

`AgentChatProvider` wraps the generic package. Its async context resolver runs only when support is opened, preserving Canto's current lack of user API requests on untouched marketing pages:

```tsx
<AgentChatWidget
  inboxId="canto-transcriber"
  resolveContext={async () => {
    const [posthog, user] = await Promise.all([initPostHog(), getUserInfo()]);

    return {
      product: "canto-transcriber",
      surface: "web",
      pageUrl: window.location.href,
      locale: document.documentElement.lang,
      posthogDistinctId: posthog?.get_distinct_id?.(),
      posthogSessionId: posthog?.get_session_id?.(),
      userId: user?.id,
      email: user?.email,
      name: user?.name,
    };
  }}
/>
```

`initPostHog()` is already single-flight and exposes the required IDs. The package must not touch browser globals during module evaluation; `<ClientOnly>` prevents server rendering but cannot make an unsafe static import safe.

Required Canto changes after the base is ready:

- replace `CrispProvider` in `apps/web/src/routes/__root.tsx`;
- add `apps/web/src/lib/agent-chat-provider.tsx`;
- remove the Crisp call from `apps/web/src/lib/user-tracking-provider.tsx`, which otherwise reloads Crisp in `/app`;
- add the package/lockfile, provider test, update the user-tracking test, and update web documentation.

No Canto backend, router, Worker binding, or generated route change is needed for this anonymous/manual base. Browser-reported IDs are displayed as unverified context and cannot authorize private data access.

## Repository shape

Use TypeScript end to end for the base:

```text
apps/
  api/                 Cloudflare Worker + Thread Durable Object
  discord-gateway/     small Node Discord bot for Cloudflare Container
  demo/                local integration/e2e host
packages/
  protocol/            zod schemas, IDs, events, errors
  react/               SSR-safe widget and client state
  translation/         Gemini adapter, masking, validation, glossary
  discord/             projections, commands, dedupe helpers
```

Avoid a general plugin framework. Translation and Discord need narrow interfaces for tests, but only one implementation each is required.

## Reliability and security invariants

- Persist before acknowledgement, broadcast, translation, or Discord work.
- `client_message_id` makes browser retries idempotent.
- A server-assigned monotonically increasing sequence orders every thread.
- Originals are immutable; translations are versioned derived records.
- WebSocket and Gateway delivery are hints; reconnect reconciles durable history.
- Queue consumers and Discord ingestion deduplicate external/event IDs.
- Translation cannot alter protected values or send on its own.
- Product/inbox routing comes from server configuration, never client context.
- Client-reported user/PostHog fields are visibly unverified and never authorization.
- Raw visitor IP is not retained; use coarse request geography.
- Browser socket tickets are one-use and short-lived; tokens/context do not enter URLs, analytics, or logs.

## Build order

A realistic target is 7–10 focused engineering days for the base plus real Discord/language soak time:

1. **Protocol/storage/API (2 days):** workspace, schemas, sessions, Thread Durable Object, D1 mapping, sequence/history/idempotency tests.
2. **React client (1–2 days):** launcher, panel, optimistic text, history/reconnect, responsive/accessibility pass, demo host.
3. **Translation (1–2 days):** Gemini adapter, masking/schema validation, language state, Queue consumer, Thai/Burmese fixtures.
4. **Discord (2–3 days):** forum/thread projection, Gateway container, ordinary replies, receipts, `/language`, echo/reconnect tests.
5. **Canto pilot (1 day):** adapter, Crisp feature switch, context, integration tests, private rollout and rollback.

Attachments are the first follow-on slice because they matter to the Canto support experience; they should not delay proving the text/translation/Discord architecture.

## Acceptance gate

The base is working when:

- the Canto root contains one support provider integration and Crisp can be selected as rollback without both widgets loading;
- a real Thai and a real Burmese message each persist, translate to useful English, and arrive in the correct Discord thread;
- an ordinary English Discord reply translates into the persisted customer language and appears exactly once in the correct browser;
- refresh, WebSocket reconnect, Queue redelivery, and Gateway reconnect do not lose or duplicate messages;
- outgoing translation failure is visible in Discord and sends no untranslated English;
- original and translated text, model/prompt version, Discord mapping, delivery state, and context provenance are inspectable through the API;
- p95 translation is below four seconds and the complete message-to-Discord path is below five seconds under pilot load.

Build a small anonymized evaluation set from actual Canto Burmese/Thai conversations. The supplied Crisp inbox URLs were not accessible from the available signed-in browser session, so volume/language statistics have not been invented; a connected browser or export is still needed for that corpus.

## After the base

Follow-on order is intentionally separate from the acceptance gate:

1. R2 screenshot/screen-recording uploads with configurable abuse limits.
2. Email continuity and server-signed Canto identity.
3. A Pi extension with a pull consumer that opens a fresh session and injects a bounded thread snapshot/context.
4. Read-only PostHog tooling, reviewed agent manual, generated support documents, and controlled auto-send.
5. SwiftUI/Jetpack Compose WebView clients, then other products.

The base should retain a durable outbox and versioned thread/message APIs so the Pi extension can subscribe later. Its Queue credential, sandbox, context, and send-authority design are deliberately not launch decisions; the current research is recorded separately in [Future Pi agent extension](../research/future-pi-agent-extension.md).
