# RK-5 — SDK 0.6.4: every SDK string from the catalog

2026-10-16 · developer

The views converted in 0.6.3 read the catalog; the rest of each client still had English literals. On iOS, `Text("Save email")` and similar calls looked the string up in the host app's main bundle, so they fell back to English. All four clients now read every user-visible string and accessibility label from the generated catalog. Ten keys were added to all 51 locales. Release 0.6.4 is prepared, not published.

## Decisions

- The native stores write text themselves (the attachment-only body and some errors). Each core gets a `RespondKitStrings` value that defaults to English, and the screen fills it from the catalog. Core keeps no dependency on UI resources.
- Protocol-integrity errors ("Mismatched support messages.") and server-provided messages stay as they are. They are diagnostics, not copy.
- `EncryptedFilePersistence`'s two storage errors stay English. They are not view code, and they surface only when the device's keystore fails.
- The guard (`scripts/native-strings.test.mjs`) flags capitalized English literals in files that import SwiftUI or Compose. The only allowed literal is `you@example.com`.

## Verification

- `swift test`: 28 passed. `xcodebuild -scheme RespondKitUI` for the iOS simulator: succeeded.
- Example-app XCUITest `testScreenAndAttachMenuFollowTheAppLanguage` on an iPhone 17 simulator with `demo_server.py`: passed in ja and zh-Hans. It checks the email ask, placeholder, send and close labels, and "Sent" after a real send. The demo server now answers `GET /v1/client/contact` so the email ask shows.
- `gradlew :core:test :compose:assembleDebug :example:assembleDebug`: passed, 25 core tests. `:compose:connectedDebugAndroidTest` on emulator-5554 (API 36): 9/9, including ja and zh-Hans.
- Web 89 tests, React Native 24, `vp check`, `localization:check` and `test:native-strings`: passed.

Translations of the new keys were written by the agent. No native-speaker review yet.

## Review RK-6 (changes requested at 71a3e48)

- SDK-authored errors reached the UI in English: Android's "File upload failed (500). Try again." and React Native's "Unable to reach RespondKit". Stores and pickers now show catalog text for any error they did not write in the user's language. Errors the SDK localizes itself are thrown as `PresentedError` / `PresentedException`. The raw message stays in `errorDetail` (Swift, Kotlin and React Native stores).
- The new ja/zh-Hans Android test of a failed request found a first-open race: `openConversation` ran before the screen's `SideEffect` handed the store its strings, so the banner was English. The screen now sets the strings at the start of its `LaunchedEffect`, and `RespondKitLifecycle` sets them on both platforms before any background refresh.
- The guard now scans every file in both UI modules, including the transcript helpers. It flags any literal in a UI-call position (so `Text("retry")` and `Button("OK")` fail), English phrases, and interpolated labels. Fixtures cover each case. Restoring 0.6.3's TranscriptRow on either platform now fails it.
- Verification: `pnpm ready` passed (455 package tests). `swift test`: 29 passed. RespondKitUI iOS build: succeeded. Android core tests: 26 passed. `:compose:connectedDebugAndroidTest` on emulator-5554: 11/11 passed.
