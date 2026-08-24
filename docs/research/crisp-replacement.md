# Crisp replacement: adopt, extend, or build

Status: preliminary research for decision-making
Last updated: 2026-08-24
Decision owner: Simon

## Bottom line

There is no credible product that satisfies the full requirement set out of the box.

The best near-term candidate is **Chatwoot**, used as one account with one inbox per product. It is the only option researched so far that is mature, actively maintained, permissively licensed, extensible enough for a custom agent, and strong on email and operator workflows. It still misses three important requirements: high-quality automatic two-way translation, a Discord thread inbox, and a proper native customer SDK for iOS.

The most sensible sequence is:

1. Pilot Chatwoot on one product and build a thin Cloudflare sidecar for translation, Discord, and the custom AI agent.
2. Keep the customer protocol and UI behind our own adapter so Chatwoot is replaceable.
3. Build the Cloudflare-native conversation backend only if the pilot proves that the remaining platform constraints matter more than the several months of engineering needed for a reliable cross-platform product.

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

## Candidate assessment

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

### 1. Chatwoot — pilot this first

Why it is the lead candidate:

- A Chatwoot account can contain multiple inboxes, including multiple website inboxes with their own settings. That maps naturally to one inbox per indie product instead of one paid Crisp workspace per product. See [Chatwoot's inbox/channel model](https://www.chatwoot.com/hc/user-guide/articles/1677492191-adding-inboxes).
- Chatwoot Cloud currently offers Hacker at $0 for two agents/500 live-chat conversations and 30-day retention, Startups at $19/agent/month annually with all channels and one-year retention, and Business at $39/agent/month with custom attributes and automation. See [cloud pricing](https://www.chatwoot.com/pricing).
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
- Start with Hacker only for UI/workflow validation, then trial Startups or Business for email/API/custom-metadata validation.
- One account, one inbox per product, one operator.
- Add a Cloudflare Worker that verifies Chatwoot webhooks, translates both directions, mirrors each conversation into Discord, and runs the custom agent.
- Do not fork Chatwoot during the pilot. Use its public APIs and keep the integration adapter isolated.

### 2. Cossistant — benchmark and watch, but do not anchor on it yet

Cossistant is extremely relevant because it independently validates the proposed “shadcn for support” direction. Its default `<Support />` widget, headless React primitives, source-owned shadcn registry install, automatic translation, AI agent, email notifications, and email replies overlap heavily with the product thesis. See [product philosophy](https://cossistant.com/docs/what), [component docs](https://cossistant.com/docs), and [pricing](https://cossistant.com/pricing).

Its translation implementation is also directionally right: it keeps the original and stores audience-specific translated message parts instead of overwriting the message. That makes it the best product to benchmark for the most painful current workflow, even if it is not yet the best operational foundation.

The current launch pricing is attractive: Free includes small usage, email replies and auto-translate; Hobby is advertised at $20/month for unlimited conversations/messages, 2,000 contacts, two seats, email replies, auto-translate, and AI credits.

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

- `@agent-chat/core`: DOM-free protocol, auth, cursor sync, outbox, typed events.
- `@agent-chat/widget`: hosted drop-in widget.
- `@agent-chat/react`: controlled/headless React primitives and source-owned recipes.
- `AgentChatCore` + `AgentChatUI`: Swift Package modules.
- `agent-chat-core` + `agent-chat-ui-compose`: Android Maven modules.
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

## Questions that change the decision

1. What are the actual client stacks for the first two products: web framework, iOS (SwiftUI/UIKit/React Native/Flutter), and Android (Compose/Views/React Native/Flutter)?
2. Is a polished WebView chat acceptable for the first mobile release, or is native SwiftUI/Compose UI a day-one requirement?
3. Roughly how many products, conversations/messages per month, attachment-heavy conversations, and important language pairs are in scope?
4. Is a single managed bill around $20–40/month across all products acceptable as a bridge, or is Cloudflare-only/data ownership already non-negotiable?
5. Can Discord replies use a Reply button/modal or `/reply` command for v0, or must typing a normal message in the thread immediately reply to the customer?
6. Should the AI auto-send today? Which knowledge sources and product APIs may it read, and which actions—if any—may it execute without approval?

## Next validation step after the questions

Run a time-boxed pilot on one real product with a representative non-English conversation:

1. Chatwoot Cloud inbox and web widget.
2. Identified user with signed product ID/PostHog metadata.
3. Customer message mirrored into a Discord thread with original + translation.
4. Operator reply translated and returned to the customer.
5. AgentBot answers one safe FAQ and hands off one deliberately unsupported request.
6. Offline email is delivered, replied to, and restored to the same conversation.
7. Chatwoot operator mobile notification is exercised on a physical device.
8. The same widget is embedded in a thin mobile WebView proof of concept if WebView is acceptable.

The result should be judged against response-time improvement, translation edits required, dropped/duplicated messages, email thread correctness, and whether the customer UI feels native enough—not against a feature checklist alone.
