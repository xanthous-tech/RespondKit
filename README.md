# RespondKit

RespondKit is a small, multilingual support stack for indie products. The MVP gives customers a React chat widget, translates customer messages to English with Gemini, projects each support thread into a Discord forum post, and translates `/reply` responses back into the customer's language.

The runtime is one Cloudflare Worker bundle with D1 and Cloudflare Workflows. It deliberately has no control-plane dashboard, Better Auth, Queue, Cron trigger, Durable Object, WebSocket, or Discord Gateway.

## Repository

```text
apps/
  api/          Hono Worker, MessageWorkflow, D1 migrations, setup scripts
  widget/       Vite playground and Playwright browser host
packages/
  protocol/     public v1 DTOs, validation, and opaque IDs
  api-client/   retry-safe customer API client
  react/        embeddable Tailwind v4 + shadcn customer widget
  workspaces/   workspace/product/inbox/origin persistence
  conversations/ thread, message, translation, and cursor persistence
  translation/  Vercel AI SDK Gemini adapter and protected-text translation
  discord/      signed interactions, REST projection, commands, and mappings
```

Feature packages export TypeScript source directly. Only `apps/api` and `apps/widget` build production bundles.

The reviewed system design and message flows are in [docs/architecture/base-v1.md](docs/architecture/base-v1.md).

## Key-free development

Requirements: Node.js 22.18 or newer and pnpm 10.33.2.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test:all
pnpm build:all
pnpm --dir apps/widget test:e2e
```

The API suite runs against Cloudflare's local Vitest pool with an isolated D1 database and local Workflow test helpers. Discord signature and REST behavior use fixtures/mocks; Gemini translation uses an injected fake model. These commands do not need external credentials.

Run the widget playground with:

```bash
pnpm dev:widget
```

## Local Cloudflare topology

Copy the example and replace its placeholder IDs:

```bash
cp apps/api/config/workspaces.example.json apps/api/config/workspaces.local.json
pnpm config:apply --local
pnpm discord:commands:apply --dry-run
```

`config:apply` validates the complete workspace → product → inbox topology, applies the checked-in D1 migration, and idempotently seeds the local database. The Discord dry run prints the guild-scoped `/reply`, `/status`, and `/retry` registration requests without contacting Discord.

Live local API development additionally needs an uncommitted `apps/api/.dev.vars`, based on `.dev.vars.example`. Do not commit it. Remote deployments should use `wrangler secret put` for secrets rather than plaintext configuration.

## React integration

The host app needs React 18.2 or newer, Tailwind CSS v4, and `@tailwindcss/vite`. Import the widget and its stylesheet once at the application entry point:

```tsx
import { RespondKitWidget } from "@respondkit/react";
import "@respondkit/react/styles.css";

export function Support() {
  return (
    <RespondKitWidget
      apiBaseUrl="https://support.example.com"
      title="Example Support"
      context={{
        inboxId: "inbox_example_public",
        userId: currentUser.id,
        email: currentUser.email,
        posthogDistinctId: posthog.get_distinct_id(),
        locale: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        path: window.location.pathname,
        metadata: { plan: currentUser.plan },
      }}
    />
  );
}
```

Customer-supplied identity and metadata are advisory context in this MVP, never authorization. The widget scopes its persisted installation/thread IDs to the supplied user ID so switching accounts cannot inherit the previous account's transcript.

The package uses shadcn primitives with Tailwind v4 utilities namespaced as `ac:` and does not import Tailwind preflight, so it can coexist with the host product's Tailwind/shadcn theme.

This release is intended for a monitored, low-volume pilot. Discord ambiguity recovery currently inspects the newest 100 messages and at most 50 active plus 50 archived forum threads. A retry delayed until the original projection has moved beyond that window can duplicate a Discord projection; production-scale use needs paginated reconciliation to a persisted boundary and a canonical content digest.

## Credential-backed validation still required

The implementation and automated tests are key-free. Before a real-world pilot, provision separate development credentials for:

- Gemini (`GEMINI_API_KEY`)
- a Discord application/bot (`DISCORD_BOT_TOKEN`, application ID, and Ed25519 public key)
- a random customer-session signing secret (`SESSION_SIGNING_KEY`)

Then run one Thai and one Burmese customer message end to end, verify English Discord projection, and invoke `/reply` in the resulting forum threads to validate localized customer delivery.
