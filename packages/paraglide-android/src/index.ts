import { formatPattern, parseResources, type ResourceInput } from "@respondkit/paraglide-resources";

function xml(value: string): string {
  // Quotes preserve leading/trailing/repeated whitespace in Android's resource compiler.
  return (
    '"' +
    value
      .replaceAll('"', '\\"')
      .replaceAll("'", "\\'")
      .replaceAll("\n", "\\n")
      .replaceAll("\r", "\\r")
      .replaceAll("\t", "\\t")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;") +
    '"'
  );
}
// Android's java.util.Locale still reports these languages by their legacy codes, and resource matching compares those.
const legacyLanguages: Readonly<Record<string, string>> = { he: "iw", id: "in", yi: "ji" };
// Android does not fall back from the macrolanguage to Bokmål, so a bare "no" also reads nb.
const aliasLanguages: Readonly<Record<string, string>> = { nb: "no" };
// Older Android ICU (and lint) still select Hebrew "many", which current CLDR folded into "other".
const categoryOrder = ["zero", "one", "two", "few", "many", "other"] as const;
const legacyCategories: Readonly<Record<string, readonly string[]>> = { he: ["many"] };
/** Return paths relative to res/. No disk writes, runtime dependency, or Kotlin generation. */
export function compileAndroidResources(input: ResourceInput): Readonly<Record<string, string>> {
  const project = parseResources(input);
  return Object.fromEntries(
    project.locales.flatMap((locale) => {
      const [language = "", ...subtags] = locale.split("-");
      const tag = [legacyLanguages[language] ?? language, ...subtags];
      const directory = (parts: string[]) =>
        locale === project.sourceLocale
          ? "values"
          : parts.length > 1
            ? `values-b+${parts.join("+")}`
            : `values-${parts[0]}`;
      const alias = subtags.length === 0 ? aliasLanguages[language] : undefined;
      const directories = [
        directory(tag),
        ...(alias && !project.locales.includes(alias) ? [directory([alias])] : []),
      ];
      const entries = project.keys.map((key) => {
        const message = project.catalogs[locale]![key]!;
        if (message.kind === "text") {
          const attribute = message.pattern.parameters.length === 0 ? ' formatted="false"' : "";
          return `    <string name="${key}"${attribute}>${xml(formatPattern(message.pattern, "android"))}</string>`;
        }
        const extra = legacyCategories[language] ?? [];
        const forms = categoryOrder.flatMap((category) => {
          const form =
            message.forms[category] ?? (extra.includes(category) ? message.forms.other : undefined);
          return form ? [[category, form] as const] : [];
        });
        const items = forms.map(
          ([category, form]) =>
            `        <item quantity="${category}">${xml(formatPattern(form, "android", message.count))}</item>`,
        );
        return [`    <plurals name="${key}">`, ...items, "    </plurals>"].join("\n");
      });
      const content = [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<!-- Generated from Paraglide JSON. Edit the source catalogs. -->",
        "<resources>",
        ...entries,
        "</resources>",
        "",
      ].join("\n");
      return directories.map((path) => [`${path}/strings.xml`, content] as const);
    }),
  );
}
