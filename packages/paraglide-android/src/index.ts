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
/** Return paths relative to res/. No disk writes, runtime dependency, or Kotlin generation. */
export function compileAndroidResources(input: ResourceInput): Readonly<Record<string, string>> {
  const project = parseResources(input);
  return Object.fromEntries(
    project.locales.map((locale) => {
      const directory =
        locale === project.sourceLocale
          ? "values"
          : locale.includes("-")
            ? `values-b+${locale.replaceAll("-", "+")}`
            : `values-${locale}`;
      const entries = project.keys.map((key) => {
        const message = project.catalogs[locale]![key]!;
        if (message.kind === "text") {
          const attribute = message.pattern.parameters.length === 0 ? ' formatted="false"' : "";
          return `    <string name="${key}"${attribute}>${xml(formatPattern(message.pattern, "android"))}</string>`;
        }
        const items = Object.entries(message.forms).map(
          ([category, form]) =>
            `        <item quantity="${category}">${xml(formatPattern(form, "android", message.count))}</item>`,
        );
        return [`    <plurals name="${key}">`, ...items, "    </plurals>"].join("\n");
      });
      return [
        `${directory}/strings.xml`,
        [
          '<?xml version="1.0" encoding="utf-8"?>',
          "<!-- Generated from Paraglide JSON. Edit the source catalogs. -->",
          "<resources>",
          ...entries,
          "</resources>",
          "",
        ].join("\n"),
      ];
    }),
  );
}
