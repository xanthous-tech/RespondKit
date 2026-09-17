# Native widgets (first version)

RespondKit now includes a Swift Package and Android core/Compose modules in this repository. They use the existing v1 customer API. There is no SDK launcher: your app owns buttons, badge placement, and full-screen presentation. The SDK opens directly into one conversation, with text messages, drafts, retries, read acknowledgements, and foreground status polling. There is no thread picker or intermediate history screen.

This is source integration for development. No release tags, Maven publication, or Captioner integration are included in this change.

## Swift Package Manager

The root `Package.swift` supports repository URL installation in Xcode or a package dependency. Requirements: Swift 6, iOS 18+. The core also builds on macOS 15 for tests; the SwiftUI screen is iOS-only.

In Xcode, **Add Package Dependencies**, enter `https://github.com/xanthous-tech/RespondKit.git`, and choose the `feat/native-widgets` branch while the PR is under review (or `main` after merge). Add the `RespondKitUI` and `RespondKitCore` products to your app. A local checkout can also be added as a local package.

```swift
// A consuming Package.swift; use the branch only during development.
.package(url: "https://github.com/xanthous-tech/RespondKit.git", branch: "feat/native-widgets")

// Target dependencies:
.product(name: "RespondKitCore", package: "RespondKit"),
.product(name: "RespondKitUI", package: "RespondKit")
```

Create and retain one `RespondKitStore` at app scope. Initialization throws if configuration or secure storage cannot be loaded; surface that error instead of replacing a visitor silently. In this example `store` has already been created by the app's startup flow:

```swift
import SwiftUI
import RespondKitCore
import RespondKitUI

struct AppRoot: View {
    let store: RespondKitStore
    @State private var showSupport = false

    var body: some View {
        Button { showSupport = true } label: {
            HStack {
                Text("Contact us")
                if store.hasUnreadReplies {
                    Circle().fill(.red).frame(width: 8, height: 8)
                        .accessibilityLabel("Unread support reply")
                }
            }
        }
        .respondKitLifecycle(store) // Stable host root, outside the cover.
        .fullScreenCover(isPresented: $showSupport) {
            RespondKitScreen(store: store, title: "Our support team")
        }
    }
}
```

Configure the store on the main actor:

```swift
let configuration = try RespondKitConfiguration(
    baseURL: URL(string: "https://api.respondkit.dev")!,
    inboxID: "your_configured_inbox",
    origin: "https://your-allowed-product-origin.example"
)
let store = try RespondKitStore(
    configuration: configuration,
    context: CustomerContext(locale: "en", timezone: TimeZone.current.identifier)
)
```

The example app at `native/examples/ios` consumes the root package locally. It demonstrates two custom triggers and a host-rendered red dot.

## Android / Compose

Requirements: API 26+, JDK 17. The included build pins Kotlin 2.2.0, AGP 8.11.1, and Compose BOM 2025.06.01 to a compatible toolchain. `native/android/core` is a JVM library; `compose` is the Android UI and encrypted persistence module. The `example` app consumes these via local Gradle project dependencies. Publication coordinates are deliberately not assigned yet.

Keep the store in an app/activity-level owner with a main-thread coroutine scope. All store methods are main-thread confined. `state` is a `StateFlow<SupportState>`; `state.hasUnreadReplies` is the host's badge input.

```kotlin
val configuration = RespondKitConfiguration(
    baseUrl = "https://api.respondkit.dev",
    inboxId = "your_configured_inbox",
    origin = "https://your-allowed-product-origin.example",
)
val store = RespondKitStore(
    configuration,
    context = CustomerContext(locale = "en"),
    persistence = EncryptedFilePersistence(applicationContext, configuration.storageScope),
    scope = applicationSupportScope, // Main dispatcher; cancel when the owner is disposed.
)
```

Mount `RespondKitLifecycle(store)` at the host root, outside the conditional support screen. Observe state with `collectAsStateWithLifecycle()` and draw your own red dot. A custom trigger navigates to a full-screen destination rendering:

```kotlin
RespondKitScreen(
    store = store,
    onClose = { navController.popBackStack() },
    title = "Our support team",
)
```

Place that destination above/outside your normal tab scaffold. The widget fills the available destination and handles keyboard insets. Close or Android Back calls the host's `onClose` directly. It installs no global navigation controller. The demo conditionally replaces the whole root screen to show the same contract without a navigation dependency.

## Accent color

Both screens inherit the host’s styling when `accentColor` is omitted. The host’s red unread dot remains independent of this theme.

```swift
// Inherits SwiftUI’s tint, falling back to the app/system accent.
RespondKitScreen(store: store)
// Override just this widget, including controls and customer bubbles.
RespondKitScreen(store: store, accentColor: .indigo)
// An enclosing host tint also styles the entire widget.
RespondKitScreen(store: store).tint(.teal)
```

SwiftUI bubbles use [TintShapeStyle](https://developer.apple.com/documentation/swiftui/shapestyle/tint) so they follow the same tint as the controls.

```kotlin
// Inherits MaterialTheme.colorScheme, including a host’s dynamic system colors.
RespondKitScreen(store, onClose = { showSupport = false })
RespondKitScreen(store, onClose = { showSupport = false }, accentColor = Color(0xFF6366F1))
```

The Compose override changes primary controls and customer bubbles inside the widget, preserving the host’s typography, shapes, surfaces, and error colors. For complete control, supply your own enclosing `MaterialTheme`. Android system colors are provided by the host using [dynamicLightColorScheme / dynamicDarkColorScheme](https://developer.android.com/develop/ui/compose/designsystems/material3); the example does this on Android 12+. Choose custom accents with sufficient contrast against your app’s surfaces, and check both light and dark mode.

Both example apps include Inherit, Indigo, Rose, and Teal controls on their host screens.

## One conversation screen

Opening the widget resumes the last conversation automatically; on the first launch it falls back to the most recently updated conversation. The selection and draft survive closing the widget and restarting the app. Routine polling never navigates away from the selected conversation. With no existing conversation, the composer appears immediately and the server thread is created only when the first message is sent.

A closed conversation remains readable, with **Send another message** inline to start a follow-up in the same screen. There is no history page, thread picker, or back navigation inside the widget. The built-in screens call `store.openConversation()`; custom UIs can use that same method to resume the conversation.

## Identity and persistence

- `origin` is required because the current RespondKit API rejects customer requests without an inbox-allowed Origin header. It is routing policy, **not proof of app identity**. Configure its allowlist in RespondKit. Native clients use a separate RespondKit bearer, never the product API's bearer.
- Anonymous support needs no extra login. A random installation identity is persisted securely. A supplied `context.userId` alone is advisory and does not authorize account history.
- For verified history, provide `identityToken` as an async callback returning a fresh assertion from your authenticated product backend. Include the same `userId` in `CustomerContext`. See [customer identity](../architecture/customer-identity.md). Never put signing secrets in the app. The SDK refreshes expiring sessions and retries authorization once; an assertion failure does not downgrade to anonymous access.
- Call `updateIdentity(context:identityToken:)` (Swift) / `updateIdentity(context, identityToken)` (Kotlin) only when host auth has settled. A subject change immediately clears visible history, rotates the installation, and best-effort revokes the old session. In-flight responses from the previous identity are discarded. This v1 does not automatically merge anonymous history on sign-in. Reinstallation recovery and synchronized read state across devices are not promised.
- Swift defaults to a scope-specific, non-synchronizing, device-only Keychain item. Android uses an AES-GCM encrypted atomic file in `noBackupFilesDir`, with a key in Android Keystore. These retain installation identity, history, drafts, immutable pending sends, and read cursors. Session tokens stay in memory. If supplying your own persistence, isolate it by `configuration.storageScope` and protect the installation ID like a credential.
- Use one store per API/inbox per app. Do not create a store inside each launcher or widget presentation. Stop foreground monitoring (`setForeground(false)`) when disposing a Swift host; cancel the owning coroutine scope on Android.

## Unread and delivery semantics

On foreground entry the store refreshes all pages of thread statuses, then polls every 10 seconds by default. It stops polling in the background. Polling creates no empty conversation. The screen's visibility is independent of the store's lifetime, so badges work while chat is closed. The demo polls every two seconds for faster local feedback. Once history or a transcript has loaded (including an empty result), later polls, reopening, and foreground refreshes keep the UI stable without loading indicators or disabling Send. Read acknowledgements are also silent. `isLoading` represents initial loads and explicit operations; `isSending` covers a send/retry from the moment it queues until it finishes.

Unread means `latestReplyCursor > locallyViewedCursor`, compared numerically. Replies in closed conversations count. Opening the widget alone does not read anything. The screen acknowledges the loaded transcript only when its end becomes visible in the foreground. New replies do not force the user away from older history; Latest messages scrolls to the end. Failed read acknowledgements persist and retry, while the local dot stays cleared. Reads on this installation do not clear unread state on another installation.

Messages have stable client IDs and immutable retry payloads. Drafts and pending IDs survive dismissal and restarts. An uncertain response can be safely retried; it cannot become a second message because the same ID and text are reused. Canonical message revisions replace existing rows. Closed conversations remain viewable and reject new sends. Customer input is limited to 6,000 UTF-16 code units, matching the current protocol.

V1 is text-only, with English UI strings and server-translated conversation content. It has no push registration, background delivery service, attachment uploads, app-icon badge, or automatic product telemetry. Supply only bounded context you intend to send to support. Arbitrary metadata is stored by the API but is not currently projected into Discord; that is separate server work.

## Run and validate

From the repository root:

```sh
swift test
xcodebuild -scheme RespondKitUI -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO
ANDROID_HOME="$HOME/Library/Android/sdk" native/android/gradlew -p native/android :core:test :compose:assembleDebug :example:assembleDebug
pnpm check
pnpm test:all
```

The shared `native/fixtures/protocol.json` is decoded by Swift/Kotlin tests and validated against the canonical TypeScript protocol schemas. Tests cover pagination, numeric cursors, offline restoration, visibility gating, failed read retries, session renewal, immutable send retries, late responses after identity changes, and message revisions.

For interactive local demos:

```sh
python3 native/examples/demo_server.py
# In another terminal:
xcodegen generate --spec native/examples/ios/project.yml
open native/examples/ios/RespondKitExample.xcodeproj
# Or Android:
native/android/gradlew -p native/android :example:installDebug
```

The fixture server binds only to `127.0.0.1:8789`, retains data in memory, and never contacts Discord or Gemini. iOS Simulator uses localhost; Android Emulator uses `10.0.2.2`. Restarting it clears server history. Open the widget and send text to receive a demo reply. After closing the widget, simulate another reply:

```sh
curl -X POST http://127.0.0.1:8789/demo/reply -H 'Content-Type: application/json' -d '{"text":"A reply while chat was closed"}'
```

Run native UI tests with the local server running for iOS. Keep simulator ad-hoc signing enabled: the example includes simulator-only Keychain entitlements, and a UI test exercises real secure persistence. Physical devices use your normal team provisioning:

```sh
xcodebuild -project native/examples/ios/RespondKitExample.xcodeproj -scheme RespondKitExample -destination 'platform=iOS Simulator,name=<your simulator>' test
native/android/gradlew -p native/android :compose:connectedDebugAndroidTest
```

Compose instrumentation uses an injected API, so it needs an emulator but no server. Demo tests do not replace a deployment-specific Discord/translation smoke test before integration rollout.

## Testing against the same live instance as the web playground

The examples default to the isolated fixture server above. Override the API URL, inbox, and allowed origin at launch to test a real deployment. These are public configuration values; no operator token or signing secret belongs in either app. Each simulator and the browser retains its own anonymous visitor and conversation history.

For the configured RespondKit test inbox:

```sh
VITE_RESPONDKIT_API_URL=https://api.respondkit.dev VITE_RESPONDKIT_INBOX_ID=inbox_respondkit_test pnpm dev:widget

# Build/install first using the commands above. Use a booted iOS Simulator:
xcrun simctl launch --terminate-running-process booted dev.respondkit.example --api-url https://api.respondkit.dev --inbox-id inbox_respondkit_test --origin http://localhost:5173 --open-support

# Android Emulator (adb from your Android SDK platform-tools):
adb shell am force-stop dev.respondkit.example
adb shell am start -n dev.respondkit.example/.MainActivity --es apiUrl https://api.respondkit.dev --es inboxId inbox_respondkit_test --es origin http://localhost:5173 --ez openSupport true
```

Close the widget to select its accent or test the host’s red dot. Send a message, close the widget while keeping the app foregrounded, then reply in the configured Discord test inbox: the dot appears on the next poll. Opening and viewing that conversation clears it. Live sends reach the real support inbox. Reuse these launch commands when restarting a live demo; ordinary launches without overrides use the local fixture configuration. Automated UI tests continue to use the local fixture.
