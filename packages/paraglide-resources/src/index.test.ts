import { describe, expect, it } from "vite-plus/test";
import { formatPattern, parseResources } from "./index";

const plural = (
  match: Record<string, string>,
  declarations = ["input count", "local category = count: plural"],
) => [{ declarations, selectors: ["category"], match }];
const parse = (value: unknown, locale = "en") =>
  parseResources({ sourceLocale: locale, catalogs: { [locale]: { example: value } } });

describe("portable message contract", () => {
  it("keeps stable positions when translations reorder or repeat parameters", () => {
    const project = parseResources({
      sourceLocale: "en",
      catalogs: {
        en: { greeting: "Hello {first}, {last}" },
        ja: { greeting: "{last} {first} ({last})" },
      },
    });
    const value = project.catalogs.ja!.greeting!;
    expect(value.kind).toBe("text");
    if (value.kind === "text") expect(formatPattern(value.pattern, "ios")).toBe("%2$@ %1$@ (%2$@)");
  });
  it("expands each locale's Intl categories using the explicit wildcard", () => {
    const value = parse(
      plural({ "category=one": "{count} file", "category=*": "{count} files" }),
      "ar",
    ).catalogs.ar!.example!;
    if (value.kind !== "plural") throw new Error("Expected plural");
    expect(Object.keys(value.forms)).toEqual(
      new Intl.PluralRules("ar").resolvedOptions().pluralCategories,
    );
    expect(value.forms.zero?.text).toBe("{count} files");
    expect(value.forms.one?.text).toBe("{count} file");
  });
  it("supports a count omitted from some plural branches", () => {
    expect(() =>
      parse(plural({ "category=one": "One file", "category=*": "{count} files" })),
    ).not.toThrow();
  });
  it("canonicalizes script/region locales without collapsing them", () => {
    expect(parse("text", "zh-hant-TW").locales).toEqual(["zh-Hant-TW"]);
  });
  it.each([
    ["nested JSON", { nested: "text" }],
    ["ICU", "{count, plural, one {file} other {files}}"],
    ["markup", "{#link}Link{/link}"],
    ["formatter", "{amount: number}"],
    ["escaped syntax", "Hello \\{name\\}"],
    ["invalid XML control", "hi\u0001"],
    ["unpaired surrogate", "hi\ud800"],
    ["multiple messages", ["a", "b"]],
    [
      "ordinal",
      plural({ "category=*": "{count}" }, [
        "input count",
        "local category = count: plural type=ordinal",
      ]),
    ],
    ["exact number", plural({ "category=0": "Empty", "category=*": "{count}" })],
    ["gender selection", [{ match: { "gender=male": "He", "gender=*": "They" } }]],
    ["plural with a second parameter", plural({ "category=*": "{name}: {count}" })],
    ["missing plural coverage", plural({ "category=one": "{count}" })],
    ["shadowed category", plural({ "category=*": "Many", "category=one": "One" })],
    ["unknown category", plural({ "category=ones": "One", "category=*": "Many" })],
    [
      "unknown field",
      [
        {
          declarations: ["input count", "local category = count: plural"],
          match: { "category=*": "{count}" },
          unsupported: true,
        },
      ],
    ],
  ])("rejects %s", (_, value) => {
    expect(() => parse(value)).toThrow(/en\/example:/);
  });
  it.each([
    { sourceLocale: "en", catalogs: { fr: { hello: "Bonjour" } } },
    { sourceLocale: "en", catalogs: { en: { hello: "Hello" }, fr: { other: "Bonjour" } } },
    { sourceLocale: "en", catalogs: { en: { hello: "Hello {name}" }, fr: { hello: "Bonjour" } } },
    { sourceLocale: "en", catalogs: { en: { "bad.key": "Hello" } } },
    { sourceLocale: "en", catalogs: { en: { hello: "Hello" }, EN: { hello: "Hello" } } },
    { sourceLocale: "en-u-nu-arab", catalogs: { "en-u-nu-arab": { hello: "Hello" } } },
    { sourceLocale: "zz", catalogs: { zz: { hello: "Hello" } } },
    { sourceLocale: "en", catalogs: { en: {} } },
  ])("rejects incompatible catalogs %#", (input) => {
    expect(() => parseResources(input)).toThrow();
  });
});
