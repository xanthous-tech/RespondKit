# @respondkit/react

An embeddable React customer-support widget for RespondKit.

## Install

```sh
pnpm add @respondkit/react react react-dom tailwindcss @tailwindcss/vite
```

The package supports React 18.2 and newer and expects the host application to process its stylesheet with Tailwind CSS v4.

## Use

Import the widget stylesheet once at the application entry point:

```tsx
import { RespondKitWidget } from "@respondkit/react";
import "@respondkit/react/styles.css";

export function Support() {
  return (
    <RespondKitWidget
      apiBaseUrl="https://api.respondkit.dev"
      title="Support"
      context={{
        inboxId: "inbox_example",
        userId: "user_123",
        email: "customer@example.com",
      }}
    />
  );
}
```

The widget can also receive locale, route, PostHog distinct ID, and arbitrary JSON-safe metadata through `context`.

## Verified account history

Version 0.2.0 adds `getIdentityToken`, an async resolver for a short-lived assertion from your authenticated backend, and `identityPending` to pause while host auth loads. These enable anonymous-to-account linking and cross-browser history recovery. `posthogDistinctId` and `posthogSessionId` remain advisory analytics context. See the [identity setup guide](https://github.com/xanthous-tech/RespondKit/blob/main/docs/architecture/customer-identity.md) for the signing contract, logout behavior, and rollout order.
