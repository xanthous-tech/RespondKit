# RK-3 — SDK 0.6.3: translate the client catalog

2026-10-16 · developer

Added `localization/messages/{locale}.json` for ReceiptGenie's 51 shipped locales. Every one of the 64 keys is translated, with plural branches per CLDR category. The generator now writes them for SwiftPM, Compose, web and React Native. Release 0.6.3 is prepared, not published.

## Locale selection

- Web and React Native share the generated `messages(locale)`. It now parses the subtags itself, because Hermes has no `Intl.Locale`. It maps `iw`, `in`, `tl` and `no`, infers the Chinese script from the region, sends Portuguese outside Brazil to `pt-PT`, ignores `-u-` extensions and falls back to English. The web widget uses the browser language when the host sends no `context.locale`.
- iOS keeps Foundation's matching. A table test runs `Bundle.preferredLocalizations` against the compiled catalog.
- Android: the emulator test showed that `values-he` and a bare `no` resolve to English. The Android compiler now writes `values-iw` and `values-in` (the legacy codes `java.util.Locale` reports) and a `values-no` copy of Bokmål. It also keeps a Hebrew `many` quantity, which older Android ICU and lint still expect.

## Tests

- iOS: the example app's XCUITest runs the app in ja and zh-Hans. It checks the subtitle and empty state, then opens the attach Menu. The example declares the catalog's languages in `Info.plist`.
- Swift `LocalizationTests` (macOS only, because `Process` is unavailable on iOS): 23 device-language fallbacks through `Bundle.preferredLocalizations`. `swift build` copies `.xcstrings` uncompiled, so the test compiles it with `xcstringstool`.
- Compose `LocalizedScreenTest`: a test activity applies the locale to its base context, the same way per-app locales do. It renders the screen in ja and zh-Hans and opens the real attach dropdown. `RespondKitScreenTest` keeps the fallback table.
- Web: widget renders in ja and zh-Hans, plus the browser-language fallback and a 28-case resolver table. A `renderToString` + `hydrateRoot` test guards against a hydration mismatch. The browser language is read through `useSyncExternalStore` with no server snapshot.
- React Native: `RespondKitScreen` rendered with `react-dom/server` and shimmed primitives in ja and zh-Hans. The test also opens the attach `Alert`.

## Verification

- `pnpm ready`: passed (vp check, release tests, localization:check, 445 package tests, builds).
- `swift test`: 26 tests passed. `xcodebuild -scheme RespondKit-Package` on the iOS simulator: test build succeeded, 24 tests passed.
- `xcodebuild test` of the example app's XCUITest on an iPhone 17 simulator, with `native/examples/demo_server.py` running: passed.
- `native/android/gradlew -p native/android :core:test :compose:assembleDebug :compose:lintRelease :example:assembleDebug`: passed, lint 0 errors.
- `:compose:connectedDebugAndroidTest` on emulator-5554 (API 36): 9/9 passed.

Review RK-4 (changes requested at b352504) is addressed in the follow-up commits: web hydration, the iOS test build, and native screen and menu coverage.

Translations were drafted by parallel agents from a shared key-context guide. Each file was validated for keys, placeholders and plural categories. No native-speaker review has been done yet.
