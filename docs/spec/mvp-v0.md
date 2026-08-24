# Agent Chat v0: clarified MVP

Status: proposed after initial research and product-owner answers
Last updated: 2026-08-24

## Outcome

Replace the two current Crisp workspaces with one support system that makes multilingual conversations fast to answer:

- Customers use a branded React chat on web, iOS, and Android.
- SwiftUI and Jetpack Compose host packages wrap the same responsive UI initially.
- Customers can send text, screenshots, screen recordings, and selected files.
- Every product inbox maps to a configured Discord channel; every customer conversation maps to a Discord thread.
- Incoming text appears in the operator's language; ordinary Discord replies are translated into the customer's language and sent back.
- An optional repository-adjacent AI agent consumes the same conversation events and automatically sends only responses covered by an approved manual and deterministic policy.
- Email keeps an offline customer in the conversation.

The v0 objective is response speed and reliable message delivery, not broad help-desk parity or a public SDK business.

## System boundary

```text
React web widget / iOS SwiftUI shell / Android Compose shell
                           |
                    messaging provider
             (paid bridge or owned Cloudflare core)
                           |
             Cloudflare integration/control plane
        identity, mappings, translation, policy, audit
          |                  |                    |
   Discord Gateway      agent event Queue       email/push
   bot + REST API       per product/agent       connectors
```

For the paid-bridge pilot, the provider remains the transcript source of truth. The Cloudflare layer stores integration mappings, translation variants, delivery attempts, agent leases, and an event audit. Provider-specific behavior sits behind a small adapter:

- `sendMessage`
- `getConversation`
- `upsertContact`
- `setConversationStatus`
- `downloadAttachment`
- verified webhook normalization

This prevents a successful pilot from locking the eventual SDK and Discord contract to one vendor.

## Buy-versus-bridge decision

There are two distinct trials; combining them prematurely obscures the tradeoff.

### Turnkey translation trial

- Freshchat Pro + Freddy Copilot: $78/month for one operator billed annually, one account with up to 30 web widgets, official iOS/Android SDKs, and automatic two-way Live Translate.
- JivoChat Enterprise: $56/month for one operator billed annually, unlimited websites, official iOS/Android SDKs, and automatic two-way translation after enabling it for a conversation.

Use each vendor's operator application during this trial. Success means the multilingual pain disappears without custom code. Neither product supplies the desired Discord-thread inbox, and neither vendor currently documents that its translation will apply to replies injected through a custom API bridge.

### Discord-first substrate trial

- HelpCrunch Pro: $20/month annually for one operator and five applications. It has the strongest ready-made mobile SDK plus per-message webhook/reply API combination, but translation and Discord are custom. Reusing one web application inside each product's native shells should keep two products within the application limit, subject to confirmation.
- Chatwoot Startups: $19/month annually for one operator and multiple product inboxes. It has the most open/replaceable backend and agent extension, but weaker customer mobile SDKs and manual translation.

If ordinary Discord replies are a hard requirement, one of these lower-cost providers plus the Cloudflare integration plane is a better comparison against building than paying for a translation add-on whose UI is bypassed.

## Stable product model

| Concept | Meaning |
| --- | --- |
| Workspace | One support owner/team and billing boundary. |
| Product | One indie product, branding configuration, identity issuer, and optional AI agent. |
| Inbox | One customer entry point for a product. Initially one per product. |
| Discord destination | One private Discord forum or text channel configured for an inbox. |
| Conversation | A durable customer support thread inside one product. |
| Discord thread | The operator projection of exactly one conversation. |
| Message | Immutable original content plus derived translations and delivery records. |
| Installation | A browser profile or app installation, including push and SDK context. |

Mappings and events always carry `workspace_id` and `product_id`; these must never be inferred from a customer-supplied URL or Discord thread title.

## Customer journeys

### Customer sends text

1. The client creates a unique `client_message_id`, saves a local pending item, and sends the original text.
2. The messaging core persists it and returns a canonical message ID and conversation sequence.
3. A translation job stores an operator-language variant without modifying the original.
4. The Discord connector creates or finds the conversation thread and posts the translated text plus access to the original.
5. The external agent receives its own normalized event if that product has an agent enabled.

### Operator replies from Discord

1. The Gateway bot receives an ordinary message created by an authorized human in a mapped thread.
2. The connector ignores bot messages, duplicates, and unsupported channels, then normalizes the event.
3. Translation protects code, URLs, variables, currency, coupon codes, and app routes before translating the reply.
4. The original operator text and customer-language translation are stored separately.
5. The messaging provider sends the translated text to the customer.
6. The bot marks delivery or posts a visible retryable error and shows the exact customer-facing translation.

Whether this sends immediately or uses a short preview/undo window is still a product decision.

### Customer sends an attachment

1. React requests `pickAttachments` through the versioned bridge.
2. Native code presents the platform photo/video picker or document picker.
3. Native code creates an attachment intent, then streams the file to a short-lived R2 upload URL; bytes never cross the JavaScript bridge as base64.
4. Finalization verifies ownership, size, checksum, and actual file type before creating the attachment message.
5. Scanning/thumbnail work runs asynchronously; staging objects are not directly downloadable.
6. Discord copies the provider attachment promptly into controlled storage because Discord CDN/provider URLs may expire.

A proposed beta limit is five attachments of at most 100 MiB each. Larger or interruption-resistant screen recordings require multipart and durable background-upload work.

### AI considers an answer

1. A product-specific agent consumer receives the persisted incoming-message event.
2. The agent claims a conversation generation/turn lease.
3. It retrieves repository documentation, the versioned support manual, and allowlisted read-only product API data.
4. Policy checks whether a matching manual entry explicitly permits automatic sending and whether all required evidence is present.
5. If eligible, the agent submits a proposed response, evidence, manual-entry IDs, and the claimed generation.
6. The core rejects a stale result if a human has replied or taken over in the meantime.
7. The accepted answer goes through the same translation and delivery path as a human message and is visibly attributed to AI.

A model's self-reported confidence is not sufficient permission to send.

## External agent transport and authority

Cloudflare HTTP pull consumers allow the agent to run beside the product repository without exposing a public webhook. The design is supported, with several constraints:

- A Queue has one active consumer mode. Multiple pull clients compete for messages; they do not each receive a copy.
- Use one shared agent-event Queue if one daemon handles both repositories, or one Queue per independently deployed product agent.
- Discord, email, analytics, and the AI agent must not compete on the same Queue. Publish distinct integration events/outboxes for each consumer.
- Pull delivery is short polling, at least once, and unordered. Empty polls return immediately and still count as operations, so the agent backs off when idle.
- The agent acknowledges only after the decision API durably records its outcome.
- Configure 14-day source retention, a dead-letter Queue, durable DLQ recording, and a Discord alert.

See [Cloudflare pull consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/), [delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), and [dead-letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/).

Direct pull currently needs an account-scoped Cloudflare API token with Queue read and write permissions because acknowledgement is a mutation. Keep the token outside the repository and restrict its account, lifetime, and source IP where practical. A later continuously deployed agent can accept a signed webhook from a push-consumer Worker instead, avoiding that account token.

Queue payloads are reference notifications, not transcripts or attachment bodies:

```json
{
  "schema": "agent-chat.event/1",
  "event_id": "evt_01...",
  "type": "conversation.customer_message.created",
  "occurred_at": "2026-08-24T00:00:00Z",
  "product_id": "product_...",
  "inbox_id": "inbox_...",
  "conversation_id": "conversation_...",
  "conversation_version": 27,
  "trigger": {
    "message_id": "message_...",
    "sequence": 27,
    "kind": "text",
    "language": "zh-Hans"
  },
  "approved_manual_digest": "sha256:...",
  "trace_id": "trace_..."
}
```

The agent uses a product-scoped credential to fetch a snapshot through the trigger sequence. The snapshot contains the authoritative transcript, translations, short-lived attachment reads, allowlisted customer/Product/PostHog context, allowed tool definitions, current control state, and approved manual digest.

The agent never receives an unrestricted send credential. It opens an idempotent run, receives a `control_epoch` and generation lease, then submits one of `reply`, `draft`, `abstain`, or `escalate` with the expected epoch, manual rule/digest, evidence references, source/manual commits, and customer/operator-language text. The conversation coordinator is the only component allowed to commit and send the answer.

Ack/retry behavior:

- Durable accepted outcome, policy-downgraded draft, already processed, superseded, or human-owned: acknowledge.
- Network error, rate limit, or server failure: explicit exponential retry.
- Invalid schema or manual mismatch: bounded retry, then DLQ and alert.
- Every call uses `event_id` or `run_id` idempotency because a late acknowledgement may coexist with redelivery.

The repository manual should be content-addressed and reviewed like code:

```text
support/
  manual.yaml
  rules/<intent>.md
  evals/<intent>.yaml
```

Each rule declares status, revision, `auto_send`, applicable products/app versions/locales, required live context, allowed read tools, exclusions, escalation cases, reviewer, and expiry. CI validates schemas and evals and registers the approved digest. A changed rule returns to shadow/draft mode until approved. Rollout is shadow, then Discord drafts, then limited per-rule/per-locale auto-send with a correction-rate circuit breaker.

## Web and native package boundary

The WebView is an implementation detail, not the public SDK contract.

```text
packages/protocol       versioned schemas for API, realtime, bridge, actions
packages/core-ts        auth, cursor synchronization, outbox, typed events
packages/react          default and headless React UI
packages/embed          hosted responsive shell

ios/AgentChatCore       public configuration, routes, events, schema models
ios/AgentChatWebView    WKWebView renderer, bridge, PhotosPicker, uploader

android/core            public configuration, routes, events, schema models
android/webview         hardened WebView, bridge, uploader
android/compose         AgentChat composable wrapper
```

Public APIs expose `AgentChatConfiguration`, identity/session methods, route and event types, theming, `reset`, and push-token registration. They do not expose `WKWebView` or Android `WebView`, allowing a future SwiftUI or Compose renderer to replace the implementation without changing the host integration.

### Signed customer context

The product backend mints a short-lived bootstrap assertion. A representative payload is:

```json
{
  "aud": "agent-chat",
  "sub": "opaque-product-user-id",
  "workspace_id": "workspace-id",
  "product_id": "product-id",
  "platform": "ios",
  "app_id": "bundle-or-package-id",
  "email": "verified@example.com",
  "email_verified": true,
  "posthog_distinct_id": "distinct-id",
  "locale": "zh-CN",
  "app_version": "1.2.3",
  "traits": { "plan": "pro" },
  "exp": 0,
  "jti": "unique-token-id"
}
```

The assertion should live for roughly five minutes and be exchanged for a revocable chat session. No signing secret belongs in React, Swift, or Kotlin. Token/PII values stay out of URLs, analytics, and logs. Client-only metadata can still be displayed but is marked untrusted.

Logout or account switching closes realtime connections, clears identity-scoped drafts and WebView data, removes the old push mapping, and starts a fresh bootstrap. Browser WebSockets use a one-use short-lived socket ticket because they cannot send a normal authorization header.

### Native bridge

Use small, schema-validated, versioned request/response envelopes. Initial capabilities are:

- React to native: `ready`, `pickAttachments`, `openExternalUrl`, `openAppAction`, `close`, `unreadCountChanged`.
- Native to React: `bootstrap`, `attachmentSelected`, `attachmentProgress`, `attachmentReady`, `attachmentFailed`, `lifecycleChanged`, `openConversation`, `sessionRefreshed`.

On iOS, require the main frame and expected security origin, and use structured argument passing rather than interpolating JavaScript. See [WKScriptMessageHandler](https://developer.apple.com/documentation/webkit/wkscriptmessagehandler) and [safe JavaScript calls](https://developer.apple.com/documentation/webkit/wkwebview/callasyncjavascript%3Aarguments%3Ainframe%3Aincontentworld%3Acompletionhandler%3A).

On Android, use origin-restricted `WebViewCompat.addWebMessageListener`, not a generally exposed JavaScript interface. See [WebViewCompat](https://developer.android.com/reference/androidx/webkit/WebViewCompat) and [Android bridge risks](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges).

### Native media handling

- iOS uses SwiftUI `PhotosPicker` for selection-scoped image/video access and a file representation for large video assets. See [PhotosPicker](https://developer.apple.com/documentation/photosui/photospicker).
- Android uses the system Photo Picker for images/video and `ACTION_OPEN_DOCUMENT` for files. AndroidX falls back on older supported devices. See [Android Photo Picker](https://developer.android.com/training/data-storage/shared/photo-picker).
- Native uploaders copy selected content into private temporary storage, stream directly to R2, and report progress/status through the bridge.
- Foreground-only retry is acceptable for the fastest beta. Reliable continuation after app suspension/termination uses background `URLSession` on iOS and persisted WorkManager jobs on Android.

The hosted page loads from exactly one HTTPS origin. The SDK rejects arbitrary navigation, mixed content, unsafe schemes, raw HTML message rendering, subframe bridge calls, and unapproved app routes.

## Discord inbox contract

Natural thread replies select a persistent Discord Gateway connection. A Worker-only interactions bot is insufficient because ordinary `MESSAGE_CREATE` events are delivered over the Gateway.

Recommended v0:

- One private Discord forum channel per product inbox, configurable to a normal text channel with threads.
- One forum post/thread per conversation; the durable mapping uses IDs, never names.
- One small supervised Cloudflare Container maintains the bot Gateway connection, heartbeat, session sequence, and resume URL.
- A Worker handles REST sends, interaction endpoints, signed callbacks, and the canonical message API.
- Reconnect performs REST/history reconciliation; Gateway delivery is not treated as durable storage.
- Only configured guild/channel IDs and authorized human roles can send customer-visible messages.
- `origin_event_id`, external IDs, and bot-author checks prevent echo loops.
- Discord attachment URLs are copied quickly to controlled storage.

Thread starter context should show the product, verified customer identity/email, plan, app/platform/version, locale, coarse location, relevant PostHog link, and AI/human state. Only allowlisted metadata is exposed.

## Translation behavior

- Preserve and display the original forever.
- Automatically translate customer text into one configured operator language.
- Automatically translate Discord replies into the conversation's confirmed customer language.
- Post the delivered customer-language version back into the Discord thread.
- Detect language initially, but persist a conversation override because short messages are ambiguous.
- Protect code, URLs, email addresses, product names, variables, prices, coupon codes, and deep links with placeholders.
- Keep translation provider/model/version and allow retranslation.
- Support a per-message “show original” and correction path.

The pilot should build a small corpus from real conversations and compare Workers AI, Google, DeepL, and an LLM for the actual language pairs. Raw token price is much less important than how often the operator must correct meaning.

## Reliability invariants

- Persist before acknowledgement or broadcast.
- `client_message_id` makes client retries idempotent.
- Every conversation has a monotonically increasing server sequence.
- Realtime sockets and push are hints; reconnect always reconciles from durable history.
- Queue consumers deduplicate because delivery is at least once and unordered.
- Every connector stores external IDs and an origin event ID.
- Human takeover increments the AI generation so a late automated response fails closed.
- Translation and connector failure never delete or mutate the original message.

## Deliberate v0 exclusions

- Native SwiftUI/Compose message renderers
- Voice/video calls
- Social messaging channels beyond Discord and email
- Reactions and message editing synchronization
- Marketing campaigns
- Advanced team assignment, SLAs, and analytics
- Arbitrary AI-written coupon codes, URLs, or mutating actions
- A multi-tenant billing/control plane

## Acceptance gate

The pilot is successful only if it demonstrates all of the following on physical iOS and Android devices and one web product:

- Signed product/user/email/PostHog context is correct and isolated across logout/account switching.
- A non-English customer message reaches the right Discord thread with a useful translation.
- A normal Discord reply reaches the customer once, in the right language, and shows the delivered translation to the operator.
- Multiple screenshots and a real screen recording upload without loading the entire file into memory.
- Network interruption exposes a safe retry and never creates duplicate attachments or messages.
- One approved manual-covered AI question auto-sends; one unsupported question reliably hands off.
- Human takeover prevents an in-flight AI duplicate.
- Offline email reply returns to the original conversation.
- Push/deep-link opening selects the right product and conversation.
- Tampered identity, hostile bridge/navigation, unsafe attachment, duplicate webhook, and Queue redelivery tests fail safely.

## Remaining decisions

1. Select the paid bridge after hands-on trials and clarification of multi-product billing.
2. Obtain read-only access to the two Crisp workspaces for actual volume, language, attachment, and email-use measurements.
3. Choose the operator language and representative customer-language benchmark.
4. Choose immediate Discord send versus a short translated-preview/undo period, and define the internal-note convention.
5. Set the screen-recording size limit and decide whether background uploads are required in v0.
6. Set minimum iOS and Android versions.
7. Decide where repository-adjacent agents run continuously and how their credentials are isolated.
8. Decide whether a customer gets one continuous conversation per product or may open multiple support threads.
