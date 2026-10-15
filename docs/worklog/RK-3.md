# RK-3 — SDK 0.6.3: translate the client catalog

2026-10-16 · developer

Added `localization/messages/{locale}.json` for ReceiptGenie's 51 shipped locales. Every one of the 64 keys is translated, with plural branches per CLDR category. The generator now writes them for SwiftPM, Compose, web and React Native. Release 0.6.3 is prepared, not published.

## Locale selection

- Web and React Native share the generated `messages(locale)`. It now parses the subtags itself, because Hermes has no `Intl.Locale`. It maps `iw`, `in`, `tl` and `no`, infers the Chinese script from the region, sends Portuguese outside Brazil to `pt-PT`, ignores `-u-` extensions and falls back to English. The web widget uses the browser language when the host sends no `context.locale`.
- iOS keeps Foundation's matching. A table test runs `Bundle.preferredLocalizations` against the compiled catalog.
- Android: the emulator test showed that `values-he` and a bare `no` resolve to English. The Android compiler now writes `values-iw` and `values-in` (the legacy codes `java.util.Locale` reports) and a `values-no` copy of Bokmål. It also keeps a Hebrew `many` quantity, which older Android ICU and lint still expect.

## Tests

- Swift `LocalizationTests`: renders ja and zh-Hans for the empty state, subtitle and attach menu, plus 23 device-language fallbacks. `swift build` copies `.xcstrings` uncompiled, so the test compiles it with `xcstringstool`.
- Compose `RespondKitScreenTest`: the screen in ja and zh-Hans, plus the fallback table on an API 36 emulator. Popups re-provide the activity's `LocalContext`, so the attach menu items are checked at resource level.
- Web: widget renders in ja and zh-Hans, the browser-language fallback, and a 28-case resolver table.
- React Native: `RespondKitScreen` rendered with `react-dom/server` and shimmed primitives in ja and zh-Hans. The test also opens the attach `Alert`.

## Verification

- `pnpm ready`: passed (vp check, release tests, localization:check, 445 package tests, builds).
- `swift test`: 26 tests passed.
- `native/android/gradlew -p native/android :core:test :compose:assembleDebug :compose:lintRelease :example:assembleDebug`: passed, lint 0 errors.
- `:compose:connectedDebugAndroidTest` on emulator-5554 (API 36): 9/9 passed.

Translations were drafted by parallel agents from a shared key-context guide. Each file was validated for keys, placeholders and plural categories. No native-speaker review has been done yet.
