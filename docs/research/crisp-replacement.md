# Crisp replacement: adopt, extend, or build

Status: preliminary research for decision-making
Last updated: 2026-08-24
Decision owner: Simon

> **Current decision (2026-08-25):** build the React-only, Canto-first Cloudflare core with durable text threads/messages, translation, a small API, and Discord as the operator UI. Paid and open-source findings below remain fallback research, not the active implementation plan. See [Canto Transcriber support base](../spec/canto-transcriber-mvp.md).

## Bottom line

There is no credible product that satisfies the full requirement set out of the box.

There are, however, credible single-account paid alternatives:

- **Freshchat Pro + Freddy Copilot** is the closest turnkey match at $78/agent/month billed annually. It combines native customer iOS/Android SDKs, up to 30 web widgets, email, operator apps, and automatic two-way Live Translate. Translation is still documented as Beta and Discord remains custom.
- **JivoChat Enterprise** is the strongest lower-cost trial at $56/agent/month billed annually. It advertises unlimited websites, native customer mobile SDKs, and automatic two-way translation after the operator enables it for a conversation. Discord and email-reply behavior still need validation.
- If Discord is non-negotiable, **HelpCrunch Pro** ($20/month annually for one operator) is the strongest paid substrate for a Cloudflare sidecar because it has native SDKs plus realtime per-message webhooks and a send-message API. Its own translation does not meet the requirement.
- **Chatwoot Startups** ($19/agent/month annually) remains the strongest open/extensible substrate, but its customer mobile and translation experiences require more work.

The most sensible sequence is:

1. Run simultaneous hands-on trials of Freshchat and JivoChat using one real multilingual conversation on web, iOS, Android, and email. If their operator apps are acceptable, one subscription may solve the urgent translation problem without a build.
2. In parallel, time-box a HelpCrunch-or-Chatwoot Cloudflare adapter spike for automatic translation, direct Discord threads, and the external agent. Keep the customer protocol/provider integration behind an adapter.
3. Build the Cloudflare-native conversation backend only if direct Discord workflow, media limits, identity control, or provider APIs remain unacceptable after those trials.

This is not an argument against building. A Cloudflare-first implementation is technically feasible and should be inexpensive to operate at indie scale. The expensive part is product correctness: native SDK lifecycle, identity, push credentials, offline synchronization, email threading, translation semantics, Discord's persistent Gateway connection, abuse controls, and long-lived client compatibility.

## Requirements interpreted as acceptance criteria

| Area | Minimum useful behavior |
| --- | --- |
| Web customer UI | Drop-in widget and source-owned/headless React option; anonymous and identified users; text, links, attachments, unread state, history, accessibility. |
| iOS and Android customer UI | A working in-app conversation surface, signed identity, attachment picker, history, deep links, foreground/background recovery, and user push notifications. |
| Translation | Preserve the original; automatically translate inbound messages for the operator and outbound replies into the conversation language; allow preview, override, and “view original.” |
| Operator notification | Immediate notification and reply without watching a dashboard. Discord thread per conversation is acceptable for v1. |
| Email continuity | Collect or receive a known email; notify an offline user; map email replies back to the same conversation; expose delivery/bounce status. |
| Context | Signed product user ID and PostHog `distinct_id`, product/workspace, plan and other metadata, browser/device, locale, coarse IP-derived location. |
| AI agent | First response when unavailable, access to knowledge and explicitly allowed tools, deterministic human handoff, transcript/audit trail, and safe action boundaries. |
| Product actions | Typed, versioned cards for coupons, upgrades, and app deep links with plain-text fallbacks. |
| Multiple products | Separate branding/configuration and routing without paying for a full support workspace per product. |

## Paid single-account assessment

Prices below are for one operator and annual billing unless noted. Vendor claims must be verified in a trial before migration.

| Candidate | Likely price | Products under one bill | Translation | Customer mobile | Discord/agent extension | Verdict |
| --- | ---: | --- | --- | --- | --- | --- |
| Freshchat Pro + Freddy Copilot | $78/month | Up to 30 web widgets in one account | ✅ automatic two-way Live Translate, currently Beta | ✅ official iOS/Android SDKs with media/files and push | 🟡 no Discord; message events require a Freshworks serverless app/forwarder | Best turnkey multilingual trial. |
| JivoChat Enterprise | $56/month | Unlimited websites | ✅ one-click enablement, then automatic two-way Google translation | ✅ official iOS/Android SDKs and customer push | 🟡 no Discord; Bot/Chat APIs need a feasibility trial | Best price/value turnkey trial. |
| HelpCrunch Pro | $20/month annual or $25 monthly | Five applications; WebView reuse makes two product widgets fit | ❌ only manual outgoing AI-editor translation | ✅ official iOS/Android SDKs, media/files and push | ✅ signed per-message webhooks and reply API; Discord still custom | Best inexpensive paid substrate. |
| Chatwoot Startups | $19/month | Multiple inboxes, roughly 15 for one agent under current fair-use guidance | ❌ manual incoming translation only | 🟡 WebView-oriented customer integrations | ✅ paid API/webhooks and AgentBot; Discord still custom | Best open/extensible substrate. |

### Freshchat — strongest turnkey multilingual trial

Freshchat Pro is $49/agent/month annually and Freddy Copilot is an additional $29. Growth and higher accounts can configure up to 30 web widgets, and the official customer SDKs cover iOS, Android, push, identity/custom properties, camera/gallery/file attachments, and external IDs. Freddy Live Translate detects incoming language, shows an operator translation, and translates the response back across roughly 45 languages on web, email, and mobile. See [pricing](https://www.freshworks.com/live-chat-software/pricing/), [Live Translate](https://crmsupport.freshworks.com/support/solutions/articles/50000009800-live-translate-by-freddy), [web-widget limits](https://crmsupport.freshworks.com/support/solutions/articles/50000004797-how-to-configure-the-web-widget-in-freshchat), and [mobile SDKs](https://developers.freshchat.com/mobile/).

It has no native Discord integration. A Cloudflare bridge is possible, but individual message events are exposed to a Freshworks serverless app, which then has to forward normalized events; this is less direct than a normal webhook. See [`onMessageCreate`](https://developers.freshworks.com/docs/app-sdk/v2.3/freshchat/serverless-apps/product-events/onmessage/). Freshchat explicitly does not expose delivered/read status for email, and Live Translate remains labelled Beta. The trial must also determine whether Live Translate applies to API-originated Discord replies or only replies composed in the Freshchat UI; do not assume it does.

### JivoChat — lower-cost all-product translation trial

JivoChat Enterprise advertises $56/agent/month annually, unlimited websites at no extra fee, native open-source iOS/Android customer SDKs, customer push, operator apps, and its Chat API. The Professional/Enterprise translator is enabled once in a conversation and then automatically translates both received and sent messages using Google Translate languages. See [pricing and unlimited-site FAQ](https://www.jivochat.com/pricing/), [translator](https://www.jivochat.com/help/agentapp/how-to-use-translator-feature.html), [mobile SDK](https://www.jivochat.com/mobilesdk/), [iOS source](https://github.com/JivoChat/JivoSDK-iOS), and [Android source](https://github.com/JivoChat/JivoSDK-Android).

This is a strong immediate multilingual alternative if the Jivo operator app replaces Discord. For the required Discord-first workflow, trial whether the Chat/Bot APIs can mirror every human/customer message and whether translation still applies to API-originated replies. Customer email reply threading, email-open status, modern SwiftUI/Compose presentation, and screen-recording selection/limits also remain trial gates.

### HelpCrunch — inexpensive paid substrate

HelpCrunch Pro advertises $25/month or $20/month annually for one operator and five applications. It has maintained iOS and Android customer SDKs, photo/video/file selection, customer and operator push, user ID/email/custom attributes/events, email follow-up, signed realtime webhooks for customer and operator chat/email messages, and a REST send-message API. See [pricing](https://helpcrunch.com/en/pricing.html), [mobile SDK overview](https://helpcrunch.com/chat-sdk.html), [iOS docs](https://docs.helpcrunch.com/en/ios-sdk), [Android docs](https://docs.helpcrunch.com/en/android-sdk), [message webhooks](https://docs.helpcrunch.com/en/webhooks/message-webhooks), and [reply API](https://docs.helpcrunch.com/en/rest-api-v1/create-message-v1).

Its translation is only a manual outgoing AI-editor action in a small set of languages, so Cloudflare must provide automatic two-way translation. It has no Discord integration. Two products each registered separately as web, iOS, and Android would exceed the five-application limit; embedding each product's web application through the short-term native WebView shells should consume only two product applications, but that billing interpretation must be confirmed during trial. The current Android SDK surfaces a 16 MB attachment limit, which is likely too small for many screen recordings.

## Open-source and developer-first candidate assessment

Legend: ✅ solid; 🟡 partial or extension required; ❌ missing; ⚠️ material risk.

| Requirement | Chatwoot | Cossistant | Libredesk | Tiledesk |
| --- | --- | --- | --- | --- |
| Web customer UI | ✅ mature widget | ✅ excellent React/headless/shadcn approach | ✅ widget and public widget API | ✅ |
| iOS/Android customer UI | 🟡 React Native/Flutter WebView paths; no proper native iOS SDK | ❌ web only in current docs | ❌ no first-party customer mobile SDK | 🟡 native SDKs exist but the iOS/Android foundations appear old |
| Automatic two-way translation | 🟡 manual translation of incoming messages through Google Translate | ✅ advertised on hosted plans | ❌ | ❌ not verified |
| Operator mobile app | ✅ official iOS/Android app | ❌ not found | ❌ current dashboard is desktop-oriented | 🟡 agent apps exist |
| Discord threads and replies | ❌ Slack only; custom bridge is possible | ❌ not found; webhooks are still marked “Soon” | ❌ signed webhooks exist, so a bridge is possible | ❌ not verified |
| Email continuity and replies | ✅, but no delivered/read status | ✅, but no implemented open tracking | ✅ | 🟡 email exists, continuity depth not verified |
| Contact/product metadata | ✅ standard fields; hosted custom attributes require Business | ✅ visitor metadata | ✅ JWT identity and contact attributes | 🟡 |
| Location/browser/locale | ✅ | ✅ broad visitor context | 🟡 country exists; automatic context is thinner | 🟡 |
| Bring-your-own AI agent and handoff | ✅ signed webhooks, APIs, AgentBot handoff | ✅ AI-native | ✅ strong KB agent/copilot and HTTP tools | ✅ AI-centric |
| Self-host | ✅ Community Edition | ✅ | ✅ lightweight Go + PostgreSQL/Redis | ✅, but many moving parts |
| Productization license | ✅ Chatwoot core is MIT | ⚠️ AGPL file plus a README statement requesting a commercial licence; clarify before basing a commercial fork on it | 🟡 AGPL-3.0 | 🟡 mixed component licences; needs a full audit |
| Operational maturity | ✅ strongest of the group | 🟡 young and moving quickly | 🟡 young; tenancy model is unclear | 🟡 complex/stale edges |

### 1. Chatwoot — strongest open-source pilot

Why it is the lead candidate:

- A Chatwoot account can contain multiple inboxes, including multiple website inboxes with their own settings. That maps naturally to one inbox per indie product instead of one paid Crisp workspace per product. See [Chatwoot's inbox/channel model](https://www.chatwoot.com/hc/user-guide/articles/1677492191-adding-inboxes).
- Chatwoot Cloud currently offers Hacker at $0 for two agents/500 live-chat conversations and 30-day retention, Startups at $19/agent/month annually with all channels and one-year retention, and Business at $39/agent/month with custom attributes and automation. See [cloud pricing](https://www.chatwoot.com/pricing).
- Since July 2026, new Chatwoot Cloud Hacker accounts no longer receive API or webhook access. The Discord/translation/agent adapter therefore requires at least a paid Startups account; self-hosted installations retain API/webhook access. See [the API/webhook access change](https://www.chatwoot.com/blog/updating-api-and-webhook-access-on-chatwoot-cloud).
- The free self-hosted Community Edition exists, but production requires Rails web and worker processes, PostgreSQL, Redis, email, and object storage. Chatwoot recommends at least 4 GB RAM and 2 CPU cores. It is not a natural Cloudflare-native deployment. See [production architecture](https://developers.chatwoot.com/self-hosted/deployment/architecture) and [requirements](https://developers.chatwoot.com/self-hosted/deployment/requirements).
- Website conversation continuity can collect an email, send the transcript/reply notification, and put the customer's email response back into the existing conversation. See [conversation continuity](https://www.chatwoot.com/hc/user-guide/articles/1677587761-how-to-continue-conversations-through-email).
- The web SDK accepts a stable user identifier, HMAC identity validation, standard profile/location fields, and custom attributes. Webhook payloads include browser, platform, referer, browser language, and widget language. See [SDK identity/context](https://www.chatwoot.com/hc/user-guide/articles/1677587234-how-to-send-additional-user-information-to-chatwoot-using-sdk), [custom attributes](https://www.chatwoot.com/hc/user-guide/articles/1677502327-how-to-create-and-use-custom-attributes), and [webhooks](https://www.chatwoot.com/hc/user-guide/articles/1677693021-how-to-use-webhooks).
- AgentBot is a native extension point: new conversations start pending, Chatwoot sends signed events to the bot, the bot replies through the API, and it can change status to open for human handoff. See [AgentBot](https://www.chatwoot.com/hc/user-guide/articles/1677497472-how-to-use-agent-bots).
- The official operator app is React Native and supports realtime notifications and replies. See [Chatwoot mobile app](https://github.com/chatwoot/chatwoot-mobile-app).

Important gaps:

- The Google Translate integration is an operator action on an incoming message. It does not provide the automatic, bidirectional draft/send workflow required here. See [translation integration](https://www.chatwoot.com/hc/user-guide/articles/1679916448-how-to-translate-your-messages-with-google-translate).
- Slack thread replies are native, but Discord is not. See [Slack integration](https://www.chatwoot.com/features/slack-integration).
- Chatwoot's channel status matrix does not expose delivered or read status for email. Email continuity is strong, but an email-open signal would still need a separate, inherently noisy tracking layer. See [message statuses](https://developers.chatwoot.com/self-hosted/message-statuses).
- The React Native customer widget is WebView-based and has open issues around keyboard behavior, repeat sessions, and push. The Flutter SDK offers both a WebView and a lower-level client, but there is no maintained native iOS customer SDK; the upstream request remains open. See [React Native widget](https://github.com/chatwoot/chatwoot-react-native-widget), [Flutter SDK](https://github.com/chatwoot/chatwoot-flutter-sdk), and [native iOS SDK request](https://github.com/chatwoot/chatwoot/issues/11598).

Recommended pilot configuration:

- Use Chatwoot Cloud rather than self-hosting for the pilot.
- Hacker can validate the unmodified widget and operator UI only. Use Startups for the integration pilot; use Business only if custom attributes must be defined and viewed inside Chatwoot rather than kept in the Cloudflare sidecar/Discord context panel.
- One account, one inbox per product, one operator.
- Add a Cloudflare Worker that verifies Chatwoot webhooks, translates both directions, mirrors each conversation into Discord, and runs the custom agent.
- Do not fork Chatwoot during the pilot. Use its public APIs and keep the integration adapter isolated.

### 2. Cossistant — benchmark and watch, but do not anchor on it yet

Cossistant is extremely relevant because it independently validates the proposed “shadcn for support” direction. Its default `<Support />` widget, headless React primitives, source-owned shadcn registry install, automatic translation, AI agent, email notifications, and email replies overlap heavily with the product thesis. See [product philosophy](https://cossistant.com/docs/what), [component docs](https://cossistant.com/docs), and [pricing](https://cossistant.com/pricing).

Its translation implementation is also directionally right: it keeps the original and stores audience-specific translated message parts instead of overwriting the message. That makes it the best product to benchmark for the most painful current workflow, even if it is not yet the best operational foundation.

The current launch pricing is attractive at first glance: Free includes small usage, email replies and auto-translate; Hobby is advertised at $20/month for unlimited conversations/messages, 2,000 contacts, two seats, email replies, auto-translate, and AI credits. However, the hosted billing implementation is website-scoped: each website needs its own subscription. Two products therefore cost $40/month at the Hobby launch rate ($60/month at the advertised regular rate), not one shared $20 plan. See [the website-scoped subscription design](https://github.com/cossistantcom/cossistant/blob/main/docs/ai-credits-metering.md) and [self-host billing behavior](https://cossistant.com/docs/self-host/billing).

Reasons not to choose it as the foundation yet:

- Current documented clients are Next.js, React, and a browser embed; native iOS/Android SDKs are not documented.
- Discord is not documented and webhooks/custom workflows are still marked “Soon” on pricing, which blocks the most useful escape hatch.
- The hosted system uses Vercel, Railway, PostgreSQL, Redis, S3/CloudFront, Upstash, Resend, and Tinybird. Self-hosting is possible, but it is not a Cloudflare-native shortcut. See [third-party services](https://cossistant.com/docs/others/third-party-services), [contributor/local stack](https://cossistant.com/docs/others/contributors), [storage](https://cossistant.com/docs/self-host/storage), and [email](https://cossistant.com/docs/self-host/email-setup).
- The repository's LICENSE file is AGPL-3.0, while the README separately says “for non-commercial use” and requests a commercial licence. That ambiguity needs written clarification before a commercial fork or derivative. See [repository and licensing statement](https://github.com/cossistantcom/cossistant).
- It is much younger than Chatwoot. Its strongest value today is as a hosted web-first option and as a benchmark for developer experience, not as the cross-platform base.

### 3. Libredesk — promising lightweight base, not a drop-in replacement

Libredesk deserves a place above the general rejection pile. It has a web widget, a documented public widget/WebSocket API, signed webhooks, email inboxes and chat-to-email continuity, JWT identity, arbitrary contact attributes, and a surprisingly capable knowledge-grounded AI assistant with handoff and HTTP tools. Its Go service with PostgreSQL and Redis is materially lighter than Chatwoot or Tiledesk. See [widget API](https://docs.libredesk.io/api-reference/widget-api), [webhooks](https://docs.libredesk.io/configuration/webhooks), [email inboxes](https://docs.libredesk.io/configuration/connecting-inboxes), [AI](https://docs.libredesk.io/configuration/ai), and [installation](https://docs.libredesk.io/getting-started/installation).

It is not an immediate match: there is no message-translation workflow, no first-party customer mobile SDK or operator app, webhook failures are not retried, and no mature multi-workspace isolation model was verified. Its AGPL licence is also a consideration for an open-core product. It is worth revisiting if the goal becomes “fork the smallest credible backend” rather than “replace Crisp this month.”

### 4. Tiledesk — feature-rich, but a poor fit

Tiledesk has a web widget, bots, operator tooling, and native mobile SDK history. However, its iOS and Android SDK roots are older Objective-C/Java-era Chat21 projects, and self-hosting brings MongoDB, RabbitMQ/MQTT, Redis, multiple servers, dashboards, and proxies. This is the opposite of the desired small Cloudflare stack. See [developer overview](https://developer.tiledesk.com/), [Chat21 SDK organization](https://github.com/chat21), and [deployment composition](https://github.com/Tiledesk/tiledesk).

### Rejected or low-priority candidates

- **Chaskiq:** capable, but its AGPL + Commons Clause licence prohibits selling the software and is unsuitable for a possible productized fork. See [licence](https://github.com/chaskiq/chaskiq/blob/main/LICENSE.txt).
- **Papercups:** elegant web-chat foundations but substantially narrower and less active than Chatwoot; not a serious full replacement for this requirement set. See [repository](https://github.com/papercups-io/papercups).
- **Bytedesk:** broad claimed web/iOS/Android/Flutter coverage, but translation, email, and multi-tenancy sit in an enterprise tier starting at ¥22,800/year, and its licence terms are a poor base for resale. See [pricing](https://www.weiyuai.cn/docs/docs/payment/) and [repository](https://github.com/Bytedesk/bytedesk).
- **FreeScout/Zammad:** useful email/ticket desks, but weak fits for rich cross-platform embedded chat and agent-first flows.

## Cloudflare-first build architecture

The following is a practical initial shape, not a commitment to every Cloudflare product:

```text
Web / iOS / Android clients
        |
        | HTTPS bootstrap, history, signed uploads
        | hibernating WebSocket for live events
        v
Cloudflare Worker API
        |
        +--> Conversation Durable Object ----> D1 relational/index data
        |          |                              workspaces, users,
        |          | ordered broadcast             conversations, search
        |          v
        |      durable event/outbox
        |
        +--> R2 attachments
        |
        +--> Cloudflare Queue (at-least-once side effects)
                    |
                    +--> translation
                    +--> AI agent and tools
                    +--> Discord mirror/replies
                    +--> email send/reply/events
                    +--> APNs / FCM / webhooks
```

Core invariants:

- Persist a message before acknowledging it or broadcasting it.
- Give every client send a `client_message_id`; make retries idempotent.
- Give every conversation a server-assigned monotonically increasing cursor/sequence. Never order by client clocks.
- Treat WebSocket and push delivery as hints. Reconnect always reconciles from durable history after the last cursor.
- Use an outbox/event ID and deduplicate every Queue consumer because Cloudflare Queues are at-least-once. See [delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/).
- Keep the original message immutable. Store translations as derived records keyed by message, target locale, and translation/provider version.
- Keep tenant/workspace identity in every database and object-storage key from day one.

### Cloudflare service fit

| Service | Role | Important note |
| --- | --- | --- |
| Workers | HTTP API, auth, upload signing, integrations | Paid plan begins at $5/month and includes 10 million requests. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/). |
| Durable Objects | Per-conversation ordering, live connections, presence/typing | Use WebSocket hibernation. Non-hibernating or outbound WebSockets accrue duration. See [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/). |
| D1 | Multi-tenant relational data, inbox queries, search/index projection | Paid databases are capped at 10 GB each and are single-threaded; database-per-tenant is a later scale option. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/). |
| R2 | Attachments and knowledge files | Use short-lived presigned upload URLs, server-side finalize/validation, and authorised downloads. |
| Queues | Translation, AI, email, Discord, push, webhooks | At-least-once and not ordered; consumers need idempotency and a dead-letter path. |
| Workers AI / AI Gateway | Translation, embeddings, agent model routing and observability | The hosted M2M100 translation model is currently $0.342/M input tokens and $0.342/M output tokens. Keep a provider interface because quality matters more than the tiny raw cost. See [model](https://developers.cloudflare.com/workers-ai/models/m2m100-1.2b/) and [AI Gateway](https://developers.cloudflare.com/ai-gateway/usage/rest-api/). |
| Email Service | Outbound support email, inbound routing, delivery events | Outbound sending is still Beta. Workers Paid includes 3,000 emails/month, then $0.35/1,000; inbound routing is unlimited. See [pricing](https://developers.cloudflare.com/email-service/platform/pricing/). |

### Email is now viable on Cloudflare, with caveats

Cloudflare Email Service can now send arbitrary transactional email using a Worker binding, REST, or SMTP, and Email Routing can deliver inbound mail to a Worker. Custom `In-Reply-To` and `References` headers are supported, and lifecycle events include delivered, deferred, bounced, failed, rejected, and complained. See [sending API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), [headers](https://developers.cloudflare.com/email-service/reference/headers/), [inbound handler](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/), and [event subscriptions](https://developers.cloudflare.com/email-service/platform/event-subscriptions/).

The sending product is still in public beta. New accounts receive a conservative unpublished daily quota, and arbitrary-recipient messages are limited to 5 MiB including attachments, so production onboarding and large files need an escape path. See [Email Service limits](https://developers.cloudflare.com/email-service/platform/limits/).

A support implementation still has to provide:

- An opaque reply address/token per conversation or notification.
- MIME and attachment parsing, quoted-reply stripping, loop/auto-responder detection, spam controls, and threading fallbacks.
- Domain onboarding, SPF/DKIM/DMARC health, suppressions, bounce handling, and per-product sender identity.
- A tracking pixel and optional redirector if “open/click” events are desired; Cloudflare does not currently expose native open/click events.

An “open” should be labelled **image loaded**, not read. Apple Mail Privacy Protection can fetch remote images in the background even if the person never reads the email, while image blocking can hide real reads. Delivery, click, and reply are progressively stronger signals. See [Apple Mail Privacy Protection](https://support.apple.com/guide/iphone/use-mail-privacy-protection-iphf084865c7/26/ios/26).

### Discord has two materially different MVPs

1. **Stateless interaction MVP:** create one Discord forum post/thread per conversation, post incoming messages through REST/webhooks, and expose Reply/Translate/Close buttons or a `/reply` command. Discord sends button, modal, and command interactions to an HTTPS Worker. This is easy to operate but human replies are not normal free-form thread messages.
2. **Natural thread-reply MVP:** allow the operator to type normally in the thread. Discord only delivers ordinary message events through its persistent Gateway WebSocket, so a bot must maintain heartbeats, sequence/resume state, reconnects, intents, and deduplication. An outbound Gateway socket prevents Durable Object hibernation and is vulnerable to runtime eviction; a supervised Cloudflare Container with resume state and REST reconciliation is the cleaner hosted design. See [Discord Gateway](https://docs.discord.com/developers/events/gateway), [threads](https://docs.discord.com/developers/topics/threads), [HTTP interactions](https://docs.discord.com/developers/platform/interactions), and [Container lifecycle](https://developers.cloudflare.com/containers/faq/).

For one personal bot, the Gateway version is reasonable. For a hosted multi-tenant product, bot installation, sharding, permission drift, rate limits, and secret isolation become a real subsystem.

## Client strategy

### Internal-use v0

Build one responsive TypeScript UI, then ship it as:

- Web: a script loader with an isolated hosted widget, plus an optional source-owned React package.
- iOS: a thin Swift Package containing a hardened `WKWebView` shell.
- Android: a thin Maven/AAR library containing a hardened `WebView` shell.
- Native bridges: signed identity bootstrap, theme/locale/safe areas, attachment picker, lifecycle/reconnect, push-token registration, and notification deep links.

This is the fastest way to obtain a consistent working UI across all three platforms. It is still not “just put the website in a WebView”: Android/iOS bridge origin restrictions, keyboard and safe-area behavior, upload pickers, account switching, local state, push, deep links, and reconnects all require native code and device testing.

### Productized SDK

Do not make React Native or Flutter the universal substrate; they are excellent adapters only when the host app already uses that runtime. A native app should not be forced to embed an entire second application runtime for support.

A durable package shape would be:

- `@respondkit/core`: DOM-free protocol, auth, cursor sync, outbox, typed events.
- `@respondkit/widget`: hosted drop-in widget.
- `@respondkit/react`: controlled/headless React primitives and source-owned recipes.
- `RespondKitCore` + `RespondKitUI`: Swift Package modules.
- `respondkit-core` + `respondkit-ui-compose`: Android Maven modules.
- React Native and Flutter adapters later.
- One generated protocol/schema with capability negotiation and plain-text fallbacks for unknown rich message types.

Push remains native even when the UI is a WebView. Each host app owns its APNs/FCM identity and credentials. Offer either managed bring-your-own credentials or a signed `notification.required` webhook into the customer's existing push service.

### Identity and PostHog context

- A public workspace/inbox ID is routing information, not authentication.
- Anonymous bootstrap returns an opaque session credential.
- Logged-in identity comes from the product backend as a short-lived signed assertion; never put the signing secret in a browser or app.
- Include product user ID, PostHog `distinct_id`, workspace/product, account/plan, and other support metadata in signed claims where trust matters.
- Treat arbitrary client metadata as untrusted display/context data.
- Model anonymous-to-identified merge and logout/account switching explicitly to avoid duplicate contacts or leaked history.
- Store coarse Cloudflare `request.cf` country/region/city/timezone and client locale/UA. Prefer not to retain a raw IP unless a defined security/support use justifies it. Cloudflare exposes geolocation on incoming Worker requests and the visitor IP in `CF-Connecting-IP`; see [request metadata](https://developers.cloudflare.com/workers/runtime-apis/request/) and [headers](https://developers.cloudflare.com/fundamentals/reference/http-headers/).

## Translation design

Translation is a first-class message projection, not a string replacement:

- Store the exact original and source-language confidence.
- Derive operator-language and customer-language variants asynchronously.
- Render the original immediately, then update when translation is ready.
- Preserve code blocks, URLs, emails, product names, variables, coupon codes, and deep links.
- Maintain a conversation language with a user/operator override; short messages such as “ok” are not reliably detectable.
- Let the operator write in their preferred language, preview the customer-facing translation, edit it, and see both versions in history.
- Version translations by provider/model/prompt so they can be regenerated and audited.
- Benchmark Workers AI against the actual language pairs and support jargon before committing. Keep DeepL/Google/LLM adapters possible.

For an AI response, ask the model for a structured answer in a canonical working language, validate tools/actions, then translate the final customer-visible text. Do not let translation errors mutate tool arguments, coupon codes, URLs, or money values.

## AI agent boundary

The useful agent is not merely RAG over documentation. It needs:

- A policy layer deciding when it may answer, ask a question, use a tool, or hand off.
- Read-only tools first: account state, plan, recent events, feature flags, entitlement and known incidents.
- Explicitly scoped mutating tools later, with typed input/output and audit records.
- Deterministic handoff on user request, low confidence, negative sentiment, repeated failure, unsupported language, tool error, or sensitive topic.
- A visible “AI” identity and an operator takeover mechanism that prevents double replies.
- A per-conversation generation epoch or lease: human takeover invalidates any in-flight AI generation before it can send a late duplicate response.
- Rate limits, token/cost budgets, prompt-injection boundaries, redaction, transcript retention, and evals built from real resolved conversations.

Coupons/upgrades/deep links should be typed actions, not prose invented by the model. For example, an `offer_card.v1` contains eligibility evidence, currency/discount, expiry, a signed redemption URL or app route, and a plain-text fallback. The host app decides how to render and execute it.

## Scope and effort

These are person-week ranges for one experienced engineer; coding agents can parallelize implementation, but do not remove device QA, deliverability, protocol design, security review, or compatibility work.

| Deliverable | Narrow internal beta | Public/product quality |
| --- | ---: | ---: |
| Chatwoot Cloud pilot | 0.5–1 | n/a |
| Cloudflare sidecar: signed webhook/API adapter, translation, basic AI handoff, Discord | 2–4 | 6–10 |
| Own realtime/auth/storage/attachment backend | 6–10 | 14–22 |
| Web widget + headless TypeScript core | 3–5 | 7–11 |
| iOS + Android WebView shells beyond the web UI | 3–6 | 9–15 |
| Email continuity | 3–6 | 8–14 |
| Native SwiftUI UI | 4–7 | 9–14 |
| Native Compose UI | 4–7 | 9–14 |

Practical calendar expectations with aggressive agent-assisted parallelism:

- **Chatwoot + sidecar usable on one product:** roughly 2–4 weeks.
- **Very narrow Cloudflare dogfood v0** (web widget, translation, Discord interaction replies, email notify/reply; deliberately thin UI): roughly 3–5 weeks.
- **Owned Cloudflare web-first internal system:** roughly 6–10 weeks.
- **Owned Cloudflare system with usable WebView iOS/Android, push, and email:** roughly 10–16 weeks.
- **A distributable, documented, stable SDK product:** several additional months. A polished native SwiftUI/Compose suite alone is roughly 35–55 client-side person-weeks once compatibility, samples, accessibility, and release engineering are counted.

The first owned release should intentionally omit reactions, edits, voice/video, social channels, advanced routing, broad analytics, native mobile UI, web push, marketing campaigns, and an elaborate operator dashboard.

## Expected runtime cost

At a working assumption of a few thousand conversations and tens of thousands of messages per month, most Workers, D1, Durable Object, Queue, and R2 usage should remain inside or near paid-plan inclusions. A reasonable initial expectation is **about $5–20/month plus the selected agent model**, not including domains or Apple/Google developer accounts.

Examples of variable cost:

- Cloudflare Workers base: $5/month.
- Email: first 3,000 outbound/month included, then $0.35/1,000.
- Translation using Workers AI M2M100: $0.342/M input tokens and $0.342/M output tokens.
- Queues: first 1M operations/month included on Paid, then $0.40/M operations.
- AI agent generation: model- and context-dependent; likely the dominant variable cost.

This estimate needs actual product count, message volume, attachment volume, language pairs, email rate, and AI resolution rate before it should be trusted.

## Product thesis

“Another open-source live-chat widget” is already crowded. Cossistant in particular is already pursuing the source-owned/headless/shadcn and AI-native story.

The more defensible wedge is:

1. **Best embedded support SDK across web and native apps**, with source-owned UI and a stable headless protocol.
2. **Typed in-product actions**, so support can safely perform upgrades, offers, account fixes, feature tours, and deep links in the app rather than only exchanging text.
3. **Agent portability**, where the customer owns the agent/tool contract and can use a hosted model, Workers AI, or their own agent.
4. **Cloudflare deployability**, with a small single-tenant template for indie teams and an optional managed control plane later.

A plausible open-core split:

- Permissive open source: protocol/schema, web/native SDK core, default components, typed action registry, single-tenant Cloudflare deployment template.
- Hosted/paid later: multi-tenant control plane, managed email and push credentials, Discord/Slack/social connectors, agent evals/observability, billing, compliance/retention, advanced routing, and zero-downtime migrations.

The internal product should come first. Productization is warranted only after the same integration is running in several of Simon's products and the typed actions measurably improve support or conversion.

## Decision update: 2026-08-24

The initial product constraints are now concrete:

- Client stacks are React on web, SwiftUI on iOS, and Jetpack Compose on Android.
- A WebView customer UI is acceptable for the short-term release, provided the surrounding native SDK handles photo-library screenshots, screen recordings, general file selection, lifecycle, and customer-context injection.
- A single managed subscription covering all products is acceptable; the objection is duplicated per-workspace pricing, not paying anything at all.
- Discord is the actual operator inbox. A configured Discord channel maps to one product inbox, each support conversation maps to a Discord thread, and ordinary operator messages in the thread must reach the customer. This selects the persistent Gateway-bot design, not the stateless button/modal design.
- The AI agent remains external to the messaging service and close to each product's source, documentation, APIs, and maintained support manual. It consumes normalized conversation events, automatically answers only manual-covered high-confidence cases, and otherwise leaves the thread to a human.
- The dominant pain is multilingual response latency. Translation quality and operator ergonomics should therefore be the first pilot success criteria, ahead of analytics breadth or a fully native chat renderer.

Two existing Crisp workspaces were supplied for a volume/language audit. The signed-in browser was unavailable in the research session and the local Crisp CLI had no configured profiles, so no conversation content or metrics have been inferred. That audit remains explicitly pending rather than being replaced with guesses.

### Consequence for the shortlist

The fastest paid trials are now **Freshchat Pro + Freddy Copilot** and **JivoChat Enterprise** because they can solve the multilingual operator workflow without first building translation. If direct Discord remains non-negotiable after those trials, evaluate **HelpCrunch Pro + Cloudflare sidecar** first and **Chatwoot Startups + sidecar** second. HelpCrunch has stronger ready-made customer mobile SDKs; Chatwoot has the stronger open-source and replaceability story.

Cossistant remains the most relevant translation and source-owned-UI benchmark, but it does not solve the single-bill problem: hosted subscriptions are scoped per website. Its missing native SDKs, missing Discord integration, immature webhooks, and commercial-licensing ambiguity prevent selecting it without a vendor clarification.

## Remaining questions that change the decision

1. Browser or API access is still needed to measure the two Crisp workspaces: recent conversation/message volume, language distribution, attachments, response times, and email-continuation usage.
2. Is using Freshchat's or JivoChat's operator app acceptable for an immediate paid solution, or is the Discord operator surface a hard launch requirement?
3. What operator language should every incoming message translate into, and which customer languages are most important for the quality benchmark?
4. Should a normal Discord reply send immediately after translation or use a short preview/undo window, and what prefix or channel behavior marks an internal note?
5. Will the repository-adjacent agent be a continuously deployed daemon or sometimes a developer laptop? Can one process load both repositories, or must each product have an isolated agent/Queue?
6. What is the expected maximum screen-recording size/duration, and must uploads survive app suspension or termination in v0?
7. Unless requested otherwise, v0 will permit AI text answers and read-only tools only. Which, if any, mutating product action must be allowed initially?

## Next validation step after the questions

Run two time-boxed validations on one real product with a representative non-English conversation.

Paid, no-custom-inbox trial:

1. Freshchat Pro + Copilot on web/iOS/Android/email.
2. JivoChat Enterprise on the same platforms and language pair.
3. Measure response time, translation corrections, attachment behavior, email continuity, identity/context, and operator notification quality.

Discord-first bridge spike:

1. Use HelpCrunch Pro first, retaining Chatwoot Startups as the open-source fallback.
2. Identify a customer with a signed product ID/PostHog context.
3. Mirror the customer message into a Discord thread with original + translation.
4. Translate a normal Discord reply and deliver it exactly once.
5. Let the source-local agent answer one approved FAQ and hand off one unsupported request.
6. Deliver and ingest an offline email reply in the same conversation.
7. Embed the responsive widget in SwiftUI/Compose shells and upload a screenshot and real screen recording from each platform.

The result should be judged against response-time improvement, translation edits required, dropped/duplicated messages, email thread correctness, and whether the customer UI feels native enough—not against a feature checklist alone.
