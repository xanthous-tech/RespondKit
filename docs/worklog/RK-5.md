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
