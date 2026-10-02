# @respondkit/react-native

A native React Native support screen for iOS and Android, sharing the RespondKit API and matching the React/SwiftUI/Compose clients. It includes system photo/file import, multiple R2 attachments, conversation history, persisted drafts and retryable sends, foreground unread refresh, visible-transcript read acknowledgements, link detection, custom colors, a local greeting, email capture, and native device diagnostics.

## Install

```sh
npm install @respondkit/react-native react-native-device-info react-native-get-random-values react-native-safe-area-context
cd ios && pod install
```

React Native 0.81+ and React 19.1+ are supported; the example is built against 0.87.1. The package includes the RespondKitFiles native module; rebuild the host and run `pod install` after upgrading. Native modules require a native build (Expo development builds work; Expo Go does not include all these modules).

For the React Native CLI Babel preset, add `@babel/plugin-transform-export-namespace-from` to your dev dependencies and `plugins` in `babel.config.js`. This handles namespace exports in Zod, which validates the shared wire protocol. Expo's Babel preset may already include it.

## Create once, mount lifecycle at the root

```tsx
import {
  createRespondKitStore,
  RespondKitLifecycle,
  RespondKitScreen,
  storagePersistence,
  useRespondKit,
} from "@respondkit/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

const store = await createRespondKitStore({
  apiBaseUrl: "https://support.example.com",
  inboxId: "inbox_example_public",
  origin: "https://your-app.example", // must be in the inbox allowlist
  persistence: storagePersistence(
    yourStorage,
    "respondkit:support.example.com:inbox_example_public",
  ),
  context: { userId: currentUser.id, email: currentUser.email, locale: "en" },
  getIdentityToken: () => fetchIdentityFromYourBackend(),
});

// Mount once outside your conditionally presented support screen.
function AppRoot() {
  return (
    <SafeAreaProvider>
      <RespondKitLifecycle store={store} />
      <YourApp />
    </SafeAreaProvider>
  );
}

// Present using your navigator or a full-screen Modal.
function Support() {
  return (
    <RespondKitScreen
      store={store}
      onClose={() => navigation.goBack()}
      title="Example Support"
      greeting="Hi! How can we help?"
      accentColor="#432dd7"
      accentForegroundColor="#ffffff"
    />
  );
}
```

`yourStorage` implements async `getItem(key)` and `setItem(key, value)`. Use an encrypted app storage driver for production conversation data. The sample uses AsyncStorage for demonstration. Persistence errors surface and block network sends until the pending payload is saved; corrupt storage is never silently replaced. Session tokens are memory-only. `memoryPersistence()` is available for previews/tests.

Use `useRespondKit(store).unreadThreadIds.size > 0` for your own trigger/badge. Keep the store and lifecycle mounted while the chat is closed. Polling pauses when the app backgrounds; push notifications are outside the existing native feature set. Call `store.dispose()` when the host permanently releases it.

When auth settles, call `await store.updateIdentity(newContext, newTokenProvider)` and `await store.refresh()`. Subject changes synchronously hide the previous account's data before revocation/network requests. Backend-signed identity enables cross-device history; client-supplied user IDs and emails alone are advisory. Include `nativeDeviceContext()` in replacement contexts, or supply your own `device` override. Never embed identity-signing secrets.

## Behavior and parity

| Feature      | React Native behavior                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| Conversation | Opens most recent/restored selection; history selector when multiple exist; closed threads offer a new conversation |
| Sending      | Optimistic bubbles, exact immutable retries, 6,000-character limit, durable pending messages and drafts             |
| Transcript   | Date separators, localized timestamps, safe HTTP(S) links, selectable text, scroll-to-latest affordance             |
| Unread       | Foreground polling while screen is closed; acknowledgements only for a loaded visible conversation                  |
| Greeting     | Optional first local bubble for a fresh store conversation; never injected into restored server history             |
| Email        | Prompt when host/server has no email; validated save and inline retry error; chat stays usable without email        |
| Device       | Model, OS version, app version, `react-native` SDK marker; host overrides supported                                 |
| Appearance   | Neutral light surfaces, full-screen safe areas, keyboard avoidance, custom title/accent/foreground colors           |

## Run and validate

From the repository root:

```sh
pnpm install
pnpm --dir apps/native-example start
# In another terminal:
pnpm --dir apps/native-example android
# Or: cd apps/native-example/ios && bundle exec pod install
# pnpm --dir apps/native-example ios
```

The example's injected transport is key-free and replies locally; it does not send mail or contact a production inbox. Remove its `client` option and configure a real inbox to exercise the deployed API. The example Android build resolves React Native from the app and build tools from React Native's dependencies, supporting both hoisted and isolated pnpm installs.

`pnpm --dir packages/react-native test` checks restart-safe retries, account isolation, expired sessions, history/transcript paging, read acknowledgements, email capture, storage failures, and duplicate taps. `pnpm --dir packages/react-native build:npm` emits JS and declarations and runs package lint. `pnpm --dir apps/native-example bundle:android` checks Metro compatibility.

## File attachments

The screen's attachment menu imports multiple photos/videos or arbitrary files using native system pickers. No broad photo-library or storage permission is required, and the SDK adds no permission entries. Imported files are staged in the app's temporary/cache directory and read in chunks for multipart R2 upload. Failed uploads retain their selection for Retry; pending message retries retain the same completed attachment IDs across restarts. A draft's unfinished selections clear when changing accounts/conversations or closing the screen. Removing an uploaded file from the draft does not expire its R2 object.

Run CocoaPods and rebuild the native app after installing this version so `RespondKitFiles` is autolinked. `pickSupportFiles("photos" | "files")` and `nativeFileSource(file)` are exported for custom host UI. The key-free example permits picker review but reports an explicit setup error for uploads until a real API/R2 inbox is configured. See [R2 setup](../../docs/integrations/attachments.md).
