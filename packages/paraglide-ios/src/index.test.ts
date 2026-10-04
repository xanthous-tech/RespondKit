import { expect, it } from "vite-plus/test";
import { compileXCStrings } from "./index";

it("emits ordinary native strings and positional string arguments", () => {
  const catalog = JSON.parse(
    compileXCStrings({
      sourceLocale: "en",
      catalogs: {
        en: {
          greeting: '  "Hello" {name}\n100% & <done>  ',
          literal: "100% done",
        },
      },
    }),
  );
  expect(catalog.sourceLanguage).toBe("en");
  expect(catalog.strings.greeting.localizations.en.stringUnit.value).toBe(
    '  "Hello" %1$@\n100%% & <done>  ',
  );
  expect(catalog.strings.literal.localizations.en.stringUnit.value).toBe("100% done");
  expect(catalog.strings.greeting.extractionState).toBe("manual");
});
it("emits String Catalog plural variations using the integer format specifier", () => {
  const catalog = JSON.parse(
    compileXCStrings({
      sourceLocale: "en",
      catalogs: {
        en: {
          new_messages: [
            {
              declarations: ["input count", "local category = count: plural"],
              match: {
                "category=one": "{count} new message",
                "category=*": "{count} new messages",
              },
            },
          ],
        },
      },
    }),
  );
  expect(catalog.strings.new_messages.localizations.en.variations.plural).toEqual({
    one: { stringUnit: { state: "translated", value: "%1$lld new message" } },
    other: { stringUnit: { state: "translated", value: "%1$lld new messages" } },
  });
});
it("is deterministic when catalogs or keys arrive in a different order", () => {
  expect(
    compileXCStrings({
      sourceLocale: "en",
      catalogs: { en: { a: "A", b: "B" }, fr: { a: "A", b: "B" } },
    }),
  ).toBe(
    compileXCStrings({
      sourceLocale: "en",
      catalogs: { fr: { b: "B", a: "A" }, en: { b: "B", a: "A" } },
    }),
  );
});
