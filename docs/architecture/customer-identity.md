# Persistent visitors and verified customer history

RespondKit 0.2.0 keeps a random browser visitor ID across page loads and anonymous-to-account login. An account can have many visitors and conversations. Linking preserves original thread IDs, messages, timestamps, and Discord threads; it does not concatenate transcripts.

## Browser lifecycle

- Browser state is scoped to the RespondKit API origin and inbox and stored in localStorage. Blocked storage falls back to memory for the current page.
- A first anonymous visit makes no API request until chat opens. Login can link an existing anonymous visitor even with chat closed.
- A verified login attaches that visitor to one inbox-scoped customer. A fresh browser logging into the same account can list and resume the customer's previous conversations.
- Logout or account switching rotates browser visitor/thread IDs and clears visible history. The widget asks the API to revoke all existing session tokens for the previous visitor. Other tabs hide history on a storage identity change and require a reload to recheck host authentication.
- Tokens expire independently of the browser identity. Verified session expiry is bounded by the identity assertion's expiry, at most five minutes. The widget refreshes credentials without clearing the transcript. If logout cannot reach the API, already-issued credentials expire within that bound.
- Pass `identityPending` while auth is loading so a temporary missing user is not interpreted as logout.

## Trust and aliases

`context.userId`, email, PostHog distinct ID and PostHog session ID are browser-reported context. They cannot authorize history access or join two customers. Aliases retain first/last observation times on the visitor and are available through its customer association. PostHog session IDs identify analytics sessions; they are not person merge keys. Identity remains scoped to the workspace and inbox.

A backend assertion establishes the authoritative account identity. A visitor already attached to Alice cannot be attached to Bob. Matching PostHog IDs never bypass this rule. Old anonymous credentials stop working once their visitor is linked to an account. Legacy raw user IDs are not automatically promoted to verified customers.

## Backend setup

Generate a distinct random secret of at least 32 characters per inbox. Store it in the product backend and, on the RespondKit Worker, in the secret `IDENTITY_SIGNING_KEYS`, a JSON object mapping inbox ID to that secret. Do not place it in browser configuration, public environment variables, or widget props. This secret is independent of `SESSION_SIGNING_KEY`.

The product's authenticated endpoint returns an HS256 JWT. It must derive `sub` and email from its validated auth session, never request-body identity fields. Use this payload:

```json
{
  "aud": "respondkit",
  "inboxId": "inbox_example_public",
  "sub": "stable-internal-user-id",
  "email": "customer@example.com",
  "iat": 1788652800,
  "exp": 1788653100
}
```

The protected header is exactly `{"alg":"HS256","typ":"JWT"}`. Email is optional; `exp - iat` must be between 1 and 300 seconds. RespondKit verifies the signature, audience, inbox, issue time and expiry, and rejects a conflicting `context.userId`. Return assertions through authenticated, non-cacheable responses; the resolver should fetch a fresh assertion each time it is called.

For example, on a Node backend after authenticating the request:

```ts
import { createHmac } from "node:crypto";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const payload = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
  aud: "respondkit",
  inboxId: configuredInboxId,
  sub: authenticatedUser.id,
  email: authenticatedUser.email,
  iat: now,
  exp: now + 300,
})}`;
const token = `${payload}.${createHmac("sha256", identitySigningKey).update(payload).digest("base64url")}`;
// Respond with JSON.stringify(token) and Cache-Control: no-store.
```

## Widget integration

```tsx
<RespondKitWidget
  apiBaseUrl="https://api.respondkit.dev"
  identityPending={session.isPending}
  getIdentityToken={async () => {
    const response = await fetch("/api/support-identity", { method: "POST" });
    if (!response.ok) throw new Error("Support identity could not be verified");
    return response.json(); // JWT string from the authenticated backend
  }}
  context={{
    inboxId: "inbox_example_public",
    userId: session.data?.user.id,
    email: session.data?.user.email,
    posthogDistinctId: analytics.distinctId,
    posthogSessionId: analytics.sessionId,
  }}
/>
```

Keep the context synchronized with authentication and PostHog session changes. PostHog identification and reset remain the host application's responsibility. The callback is called only for a supplied user ID. A failed assertion never falls back to account history through a raw user ID.

Hosts without a resolver continue to use anonymous/advisory sessions. `RESPONDKIT_IDENTITY_VERSION === 1` is exported as a capability marker for coordinated rollouts.

## API and persistence

- `POST /v1/client/sessions` accepts optional `identityToken` alongside installation ID and context. It links or resumes the visitor and issues a scoped session.
- `GET /v1/threads?after=<cursor>` returns up to 100 authorized conversations and an optional `nextCursor`. The cursor is an opaque thread ID in stable ascending order. The widget can load further pages with More.
- `GET /v1/threads/:threadId` restores a known active conversation even when it is outside the first history page.
- Message reads and writes accept any thread owned by the verified customer. Anonymous tokens remain limited to their original visitor.
- `POST /v1/client/logout` invalidates all currently issued tokens for that visitor by incrementing its session version. It does not delete or unlink history.

The additive D1 migration introduces `customer`, `visitor_customer`, `visitor_alias`, and `visitor.session_version`. It preserves existing user/PostHog context as advisory aliases. The widget imports existing anonymous storage keys once. For pre-0.2 account-scoped browser keys, the widget imports the current account’s existing installation only with a backend assertion, then removes those legacy keys after a successful link. Historical rows from browsers that have already forgotten their installation cannot be automatically claimed through raw user IDs. There is no historical merge based solely on matching advisory IDs.

## Rollout order

1. Apply migration `0001_thankful_ezekiel.sql` and deploy the updated API.
2. Provision the matching per-inbox signing secret on both backends.
3. Publish protocol, API client and React packages at 0.2.0 in dependency order.
4. Upgrade the host SDK and enable its authenticated assertion resolver.
5. Verify anonymous chat → login → same thread, fresh browser → login → recovered history, and logout/account switching → isolated history.

Do not downgrade a host to an anonymous-only SDK after linking visitors: the API intentionally denies unverified access to linked visitors. Disabling linking does not delete data; re-enable a compatible host to recover verified history.
