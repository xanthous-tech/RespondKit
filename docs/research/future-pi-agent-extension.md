# Future Pi agent extension

Status: deferred research; not part of the Canto support base  
Last updated: 2026-08-25

## Product direction

After the base React/thread/translation/Discord product works, a Canto-specific Pi extension should act as a pull consumer. An incoming support event opens a fresh Pi session and injects a bounded thread snapshot plus product context. Each product eventually has an isolated extension, repository/manual, analytics tooling, and credentials.

Do not implement or freeze this contract during the base build. The base only preserves the prerequisites:

- immutable ordered thread/message APIs;
- original plus English translation variants;
- provenance-labelled customer context;
- a transactional outbox and versioned customer-message event;
- idempotent message submission and human/agent attribution.

## Likely Pi lifecycle

```text
customer message committed
  → event available to product pull consumer
  → extension starts a fresh in-memory Pi session
  → injects trigger + bounded thread snapshot + repository/manual context
  → Pi reads source/docs and calls allowlisted product tools
  → extension submits draft/reply/abstain/escalate through Agent Chat API
```

The implementation should use the current `@earendil-works/pi-coding-agent` SDK with an in-memory session per run. Pi moved packages in May 2026; see the [migration notice](https://pi.dev/news/2026/5/7/pi-has-a-new-home) and [SDK](https://pi.dev/docs/latest/sdk).

Customer messages are hostile input. Pi's own documentation says it is not a filesystem/network/process permission boundary, so a future runner still needs external isolation and typed capabilities. See [permissions/containerization](https://github.com/earendil-works/pi#permissions--containerization) and [security policy](https://github.com/earendil-works/pi/security).

## Deliberately unresolved pull boundary

There are two viable shapes to evaluate later:

1. The Pi extension pulls a dedicated Cloudflare Queue directly.
2. A Cloudflare consumer materializes durable jobs, and the Pi extension pulls a product-scoped Agent Chat API.

Direct Queue pull matches the desired extension ergonomics. The tradeoff is credential scope: acknowledgement requires Queues read and write, and Cloudflare permissions are account-scoped. See [pull consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/) and [API-token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/). This may be acceptable for a private single-account deployment; it should be re-evaluated before becoming a product contract.

Cloudflare Queues are at least once and unordered, so either design needs idempotent event/run IDs, bounded retry, and a dead-letter path. See [delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/).

## Later context and tool questions

PostHog should stay product-owned. A promising least-privilege shape is a parameterized [PostHog Endpoint](https://posthog.com/docs/endpoints) with `endpoint:read`, fixed variables/window/columns, and a typed `get_current_customer_activity` tool. A generic `query:read` key permits arbitrary HogQL across the project and should not be handed to a customer-prompted process. See [Endpoints versus Query API](https://posthog.com/docs/endpoints/endpoints-vs-query-api) and [project secret keys](https://posthog.com/docs/api/project-secret-api-keys).

Other questions to resolve only after the base exists:

- direct Queue token versus product-scoped job API;
- Mac mini runner versus per-run [Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/);
- signed Canto identity and which PostHog ID can authorize a lookup;
- answer-agent read tools versus a separate manual-maintenance mode;
- human takeover/stale-run semantics and whether auto-send exists at all;
- safe generated support documents versus repository-owned reusable articles.

The likely first runner is the always-on Mac mini because the source repository is already local. Cloudflare Sandbox has stronger per-run VM isolation, but its filesystem/process state disappears after an idle sandbox sleeps and source/manual artifacts must be hydrated or baked for each run. See [Sandbox lifecycle](https://developers.cloudflare.com/sandbox/concepts/sandboxes/).
