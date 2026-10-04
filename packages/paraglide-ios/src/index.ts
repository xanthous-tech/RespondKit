import { formatPattern, parseResources, type ResourceInput } from "@respondkit/paraglide-resources";

/** Emit a String Catalog; Xcode compiles it into the SDK resource bundle. */
export function compileXCStrings(input: ResourceInput): string {
  const project = parseResources(input);
  const strings = Object.fromEntries(
    project.keys.map((key) => [
      key,
      {
        // JSON owns these keys; prevent Xcode extraction from treating them as stale.
        extractionState: "manual",
        localizations: Object.fromEntries(
          project.locales.map((locale) => {
            const message = project.catalogs[locale]![key]!;
            const unit = (value: string) => ({ stringUnit: { state: "translated", value } });
            return [
              locale,
              message.kind === "text"
                ? unit(formatPattern(message.pattern, "ios"))
                : {
                    variations: {
                      plural: Object.fromEntries(
                        Object.entries(message.forms).map(([category, form]) => [
                          category,
                          unit(formatPattern(form, "ios", message.count)),
                        ]),
                      ),
                    },
                  },
            ];
          }),
        ),
      },
    ]),
  );
  return `${JSON.stringify({ sourceLanguage: project.sourceLocale, strings, version: "1.0" }, null, 2)}\n`;
}
