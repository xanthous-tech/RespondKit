# PostHog activity in Discord

Run `/activity` in a mapped support thread. The server resolves the customer and the inbox's configured PostHog project. Activity is shared with operators in that Discord thread and never enters the customer transcript. Translation and reply delivery are independent of PostHog.

| Command | Result |
| --- | --- |
| `/activity` | Latest 20 matching events in the last seven days |
| `/activity count:50` | Latest 50 matching events in the last seven days |
| `/activity minutes:30` | Last 30 minutes, capped at 100 events |
| `/activity minutes:60 count:50` | Latest 50 matching events in that hour |
| `/activity minutes:30 kind:pageviews` | Pageviews in the last 30 minutes |
| `/activity minutes:30 until:last_message` | Activity in the 30 minutes before the latest customer message |

Count is 1–100. Minutes is 1–10080. `kind` is `all` (default), `pageviews`, or `events`. `until` is `now` (default) or `last_message`. Both bounds and the timezone appear in the result. Results appear newest first in a Discord card, grouped by local date. The card title opens PostHog Activity with the same distinct ID, inclusive UTC time window, event-kind filter, requested count, and newest-first ordering. This reruns the query when opened, so late-arriving events can change the results. PostHog requires the operator’s own login; the link contains no API credential. Unusually long links are included in the attachment instead. Long timelines have a short preview and a complete `customer-activity.txt` attachment. Truncation is explicit. No results means no matching captured events, not proof of inactivity.

The exact thread visitor's browser-reported PostHog distinct ID is used. There is no email fallback or automatic expansion across person aliases. Hosts already supplying `posthogDistinctId` need no client update; hosts without it must provide it in customer context. This command does not infer a website departure from chat presence or `lastSeenAt`.

## Configuration

`POSTHOG_ACTIVITY_INBOXES` is a JSON object mapping inbox IDs to fixed connections. Host supports PostHog EU and US Cloud. Never accept these connection settings from a slash command or model arguments.

```json
{
  "inbox_captioner_public": {
    "host": "https://eu.posthog.com",
    "projectId": 57374,
    "endpoint": "respondkit_customer_activity_v1",
    "version": 2
  }
}
```

Store credentials separately as `POSTHOG_API_KEY_<inbox ID>` Worker secrets. The deployed Captioner secret is `POSTHOG_API_KEY_inbox_captioner_public`. It is a personal key restricted to project 57374 and `endpoint:read`; the account could not create project-owned keys. An administrator can substitute a project secret API key with the same scope. No `query:read`, write scopes, or client-side token is needed. Do not commit the value.

The saved endpoint uses [posthog-activity.sql](./posthog-activity.sql). Its five dedicated PostHog variables are `respondkit_distinct_id` (String), `respondkit_start_time` (String), `respondkit_end_time` (String), `respondkit_event_kind` (String), and `respondkit_row_limit` (Number). Defaults are a nonexistent identity, Unix-epoch bounds, `all`, and 20. All five are supplied and validated by the service: PostHog currently falls back to variable defaults when they are omitted.

Times sent to PostHog are UTC at second precision. The query enforces a maximum seven-day window ending at the selected timestamp and a maximum 101 returned rows. The extra row detects truncation at the 100-event display limit. The response is checked again for identity, time bounds, event filters, and expected columns before publication.

`all` includes custom events and `$pageview`, `$pageleave`, `$screen`, `$exception`, `$rageclick`. `events` includes custom events and `$exception`, `$rageclick`. `pageviews` includes only `$pageview`. Autocapture, web vitals, identification and property updates are excluded. Only selected properties are exposed; paths lose query strings/fragments, text is bounded and stripped of Discord formatting, and mentions are disabled.

The endpoint is not materialized. PostHog's configured minimum freshness is 900 seconds, so requests use `refresh: "force"` to bypass response caching. Ingestion can still lag. See [PostHog execution](https://posthog.com/docs/endpoints/execution).

## Runtime and deployment

The signed interaction is immediately deferred privately. The existing application/guild/forum/thread/operator authorization runs before any provider call. The query has a 12-second timeout; failures are private and include safe HTTP status guidance. Results use one bot message, with a deterministic interaction-derived nonce for Discord's recent-message deduplication. No interaction credentials or event rows are persisted. This is an on-demand snapshot, not a durable job: rerun the command after a timeout. A new invocation intentionally creates a new snapshot.

The server uses the interaction snowflake for the `now` anchor. `last_message` selects the latest customer message accepted before the interaction. The visitor identity is resolved at execution time. Discord's nonce retention is short-lived; this does not promise permanent deduplication of arbitrarily delayed deliveries.

1. Configure the endpoint and its variables in PostHog; pin its tested version.
2. Provision the per-inbox Worker secret and `POSTHOG_ACTIVITY_INBOXES` setting.
3. Deploy the API. No database migration is required.
4. Run `pnpm discord:commands:apply --dry-run`, then `pnpm discord:commands:apply` with the existing bot credentials.
5. Allow `/activity` for operators under Server Settings → Integrations → RespondKit. Keep Send Messages in Threads, **Embed Links**, and **Attach Files** enabled. No additional OAuth scope or privileged Gateway intent is needed.

## Verification

Run `pnpm check`, `pnpm test:all`, and `pnpm build:all`. On Node 26, use `NODE_OPTIONS=--no-experimental-webstorage pnpm test:all` for the existing jsdom tests.

In a Captioner support thread, run `/activity count:5`, then `/activity minutes:30 until:last_message`. Compare the identity, window and events with PostHog. Check `kind:pageviews` and a large count that produces an attachment. Unauthorized users and threads must not query PostHog. Missing identity/configuration and provider failures must produce only a private response. The endpoint and restricted credential were tested against Captioner before this integration was built; the slash command's signed ingress, query, formatting, attachment, and isolation paths are covered by automated tests.
