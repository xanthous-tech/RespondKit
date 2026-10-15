# Shared localization source

Edit `messages/en.json` and reviewed locale files, then run:

```sh
pnpm localization:generate
pnpm localization:check
```

`project.inlang/settings.json` defines the base language and release locales. Add each new locale there and supply all message IDs in `messages/{locale}.json`. This is ordinary inlang message-format JSON, compatible with Paraglide JS. The native exporters are intentionally limited to the contract below. They do not load arbitrary inlang plugins.

The generator writes `native/swift/Sources/RespondKitUI/Resources/RespondKit.xcstrings` (the SwiftPM resource of `RespondKitUI`) `generated/android/res/values*/strings.xml` (a resource directory of the Compose module), and one TypeScript module copied to `packages/react/src/widget/messages.ts` and `packages/react-native/src/messages.ts`. Commit the outputs with the JSON changes. `pnpm ready` fails if an output is missing, modified, or left behind after removing a locale. Generated files belong to this pipeline; edits in Xcode or Android Studio must be made in JSON instead. No translation services run during compilation.

Every client reads the empty state, the "Ask us anything" subtitle and the attach menu from the generated output, and Compose also reads its closed-conversation strings from it. Other views still use English literals. The catalog ships ReceiptGenie's 51 app locales plus English. Adding a language means adding it to `settings.json` with a complete `messages/{locale}.json`.

Locale selection per client:

- iOS uses the app's language through the SwiftPM bundle, so the host app must list the language among its own localizations. Foundation matches regional and legacy tags (`zh-TW` to `zh-Hant`, `iw` to `he`, `no` to `nb`, `pt-AO` to `pt-PT`).
- Android uses the activity's resource configuration. Android still reports Hebrew and Indonesian as `iw` and `in`, so those catalogs are generated as `values-iw` and `values-in`. Bokmål is also written to `values-no`.
- The web widget uses the host's `context.locale`, else the browser language. React Native uses the device locale. Both use the generated `messages(locale)`, which maps legacy codes (`iw`, `in`, `tl`, `no`), infers the Chinese script from the region (`TW`, `HK` and `MO` read Traditional), sends Portuguese outside Brazil to `pt-PT`, strips regions down to the base language, and falls back to English.

## Portable message contract

| Use               | Contract                                                                                                                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain strings     | Flat `lower_snake_case` IDs. RespondKit uses the `respondkit_` prefix. Unicode, quotes, percent signs, newlines, and text punctuation are supported.                                                                                                       |
| String parameters | `{name}` syntax only. All ordinary parameters are strings, including already formatted dates or numbers. Parameters are ordered alphabetically by name for native positional arguments; translations may reorder or repeat them but may not add/drop them. |
| Cardinal plurals  | One integer input, one `plural` declaration, one selector. The count is the only permitted interpolation in its branches. Pass nonnegative integers up to 2,147,483,647 on every client.                                                                   |
| Plural branches   | `zero`, `one`, `two`, `few`, `many`, `other`, plus a final `*` fallback. Supply each locale's categories or use the fallback deliberately. A branch may omit the displayed count.                                                                          |
| Locales           | Language, optional script, optional region: `en`, `pt-BR`, `zh-Hant`, `zh-Hant-TW`. Case is canonicalized. Aliases that canonicalize to the same locale are rejected. Every locale must contain the same IDs and argument names as the base locale.        |

Do **not** use nested JSON, literal braces, backslash escape syntax, ICU strings, markup tags, custom functions, `number`/`datetime`/`relativetime` annotations, ordinal plurals, decimal counts, exact-number matches, gender/platform selectors, multiple selectors, or multiple plural variables. These fail validation rather than silently losing behavior. Date/time formatting stays in the platform's existing code. Format percentages before passing them as string arguments.

Keep conditional UI in the client. For a special empty-state message, use a separate key selected by `count === 0`; the grammatical plural category `zero` is not an exact-number condition. Do not interpolate a plural category itself into the text.

```json
{
  "respondkit_remove_file": "Remove {name}",
  "respondkit_show_new": [
    {
      "declarations": ["input count", "local category = count: plural"],
      "selectors": ["category"],
      "match": {
        "category=one": "Show {count} new message",
        "category=*": "Show {count} new messages"
      }
    }
  ]
}
```

Use this count pattern even for count-bearing labels with identical English forms, such as `{count} new`; a wildcard-only message leaves other languages room to supply actual plural variants.

## Plural generation

The shared validator uses `Intl.PluralRules(locale, { type: "cardinal" }).resolvedOptions().pluralCategories`, the same family of rules Paraglide uses. Each category maps to its explicit translation or the final wildcard. It does not sample a few numbers or guess plural translations. A missing category without a wildcard fails the build. Categories unused in a locale are omitted from its native resource.

The output contains patterns, not sentences pre-rendered for example counts. Xcode and Android compile these resources and select the appropriate form for the real count at runtime. Native OS and Node ICU versions can differ; exact formatting across every OS version is not promised. CI tests the shared contract against Paraglide JS 2.20.2 and inlang message-format 4.3.0 in English, Arabic, Russian, Polish, French, and Traditional Chinese. Upgrade these pins deliberately with the compatibility tests.

## Packages and build API

- `@respondkit/paraglide-ios`: `compileXCStrings(input)` returns the catalog JSON as a string.
- `@respondkit/paraglide-android`: `compileAndroidResources(input)` returns a map of relative resource paths to XML strings.
- `@respondkit/paraglide-resources`: shared validation, placeholder conversion, and plural expansion. `compileJavaScriptMessages(input)` returns the TypeScript module for web and React Native: `messages(locale)` gives typed functions per message ID.

These are private workspace packages for now. They build independently with `pnpm --filter @respondkit/paraglide-ios build` and the equivalent Android command. They are not published npm packages. Paraglide and its plugin are test-only dependencies; the compilers have no network calls or Paraglide runtime dependency.

```ts
import { compileXCStrings } from "@respondkit/paraglide-ios";
import { compileAndroidResources } from "@respondkit/paraglide-android";

const input = { sourceLocale: "en", catalogs: { en: english, fr: french } };
const xcstrings = compileXCStrings(input);
const androidFiles = compileAndroidResources(input);
```

Callers own writing the returned files. Both APIs validate the entire input before returning. The repository command uses our one fixed message directory; it is not a general inlang project loader.

## Native integration

For SwiftPM, place `RespondKit.xcstrings` in the UI target's resource directory, configure `.process("Resources")` and the package's `defaultLocalization`, and use the SDK's `.module` bundle. Stable JSON keys are marked `extractionState: manual` because JSON owns them; Xcode source extraction must not remove them.

```swift
Text("respondkit_support", tableName: "RespondKit", bundle: .module)

let format = NSLocalizedString(
  "respondkit_show_new", tableName: "RespondKit", bundle: .module, comment: ""
)
let label = String.localizedStringWithFormat(format, Int64(count))
```

For Android, place the generated directories under the library's `src/main/res`. The base locale supplies `values/strings.xml`; other locales use `values-fr` or BCP 47 directories such as `values-b+zh+Hant`. Static strings use `formatted="false"`; dynamic strings use positional placeholders and escaped percent signs. Quoted XML text preserves whitespace.

```kotlin
stringResource(R.string.respondkit_remove_file, fileName)
pluralStringResource(R.plurals.respondkit_show_new, count, count)
```

Both counts are required in the last call: the first selects the plural category, the second fills the displayed number. Web and React Native use the generated TypeScript module rather than Paraglide's JavaScript compiler, which would load the inlang project and its CDN-hosted plugin at build time.

## Inspected translation surface

The initial 64-key English catalog is based on these existing SDK files:

| Surface      | Files                                                                                                                            | Required message features                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Web widget   | `packages/react/src/widget/{respondkit-widget,message-list,message-composer,email-prompt,use-respondkit}.tsx` (hook is `.ts`)    | Plain controls, accessibility labels, send states, recoverable error fallbacks, file name, unread count |
| React Native | `packages/react-native/src/{screen,attachment-picker}.tsx`, `store.ts`                                                           | Same controls, file name, conversation date, unread count                                               |
| SwiftUI      | `native/swift/Sources/RespondKitUI/{RespondKitScreen,TranscriptRow}.swift`                                                       | Plain controls/statuses and unread count                                                                |
| Compose      | `native/android/compose/src/main/kotlin/dev/respondkit/compose/{RespondKitScreen,AttachmentPicker}.kt`, `res/values/strings.xml` | Plain controls/statuses, conversation date and unread count                                             |

Shared English labels are deduplicated. Existing variants such as the short introduction and return-to-app hint remain separate keys. This is a seed catalog for migration, not a claim that every possible backend/platform exception is translated. Host-provided titles/greetings, customer messages, filenames, and URLs remain external content. Conversation translation is the existing server feature; OS picker chrome is localized by the OS. None of these requires a more expressive resource compiler.

References: [Paraglide variants](https://github.com/opral/paraglide-js/blob/main/docs/variants.md), [Apple string catalogs](https://developer.apple.com/documentation/xcode/localizing-and-varying-text-with-a-string-catalog), [Android resources](https://developer.android.com/guide/topics/resources/string-resource).
