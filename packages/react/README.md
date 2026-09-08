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

## Unread replies

Version 0.3.0 adds unread reply notifications. The launcher checks for published operator replies every 10 seconds while the browser tab is visible, including while the chat is closed. Open conversations continue fetching messages every two seconds. Returning to the tab triggers an immediate check.

A red dot and an accessible “Unread support reply” description indicate unread replies in any authorized conversation. The conversation selector labels histories with unread replies, including those beyond the first history page. Loading a conversation in the open, visible chat marks its loaded transcript as read; opening the launcher alone does not clear a reply that has not loaded yet.

Read cursors are saved per visitor and conversation in this browser's local storage and synchronize between tabs. Another browser has its own read state. Existing anonymous conversations resume checks after reload; untouched anonymous pages do not create a support session until opened. Auth loading, logout, and cross-tab identity changes stop checks and hide the previous identity's unread state.

Deploy the API's new `/v1/thread-statuses` endpoint before releasing/upgrading this widget. There is no database migration. Existing API response shapes are unchanged; an older API will leave background notifications unavailable while message polling continues.

## Custom launchers

Version 0.4.0 adds `renderLauncher` to replace the floating bubble with your own button. The widget still owns chat state, unread tracking, and focus restoration. Spread `buttonProps` onto the actual button (including its `ref`). The renderer can return `createPortal(...)` to place the control in a toolbar while keeping one widget mounted across navigation. Returning `null` hides the launcher without discarding the chat.

```tsx
<RespondKitWidget
  apiBaseUrl="https://api.respondkit.dev"
  context={{ inboxId: "inbox_example" }}
  renderLauncher={({ buttonProps, hasUnreadReplies }) => (
    <button {...buttonProps} style={{ background: "#b0e64c", color: "black" }}>
      Support {hasUnreadReplies ? "•" : ""}
    </button>
  )}
/>
```

Custom launchers own their appearance and should show `hasUnreadReplies`; the supplied button props already include an accessible unread description. The default floating launcher is unchanged when the prop is omitted.

### Discord read receipts

Starting with 0.4.1, an open, visible conversation acknowledges its committed transcript to the API. RespondKit adds ✅ to read operator replies in Discord. Unread polling alone does not mark a reply read. Local unread indicators update immediately; failed server acknowledgements retry during polling and after reload. Deploy the matching API read-receipt endpoint and migration before upgrading the widget.
