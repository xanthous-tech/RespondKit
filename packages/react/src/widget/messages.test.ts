import { describe, expect, it } from "vite-plus/test";
import { messages } from "./messages";

describe("messages", () => {
  it.each([
    ["zh-TW", "zh-Hant"],
    ["zh-HK", "zh-Hant"],
    ["zh-Hant-MO", "zh-Hant"],
    ["zh", "zh-Hans"],
    ["zh-CN", "zh-Hans"],
    ["zh-SG", "zh-Hans"],
    ["zh_Hans_CN", "zh-Hans"],
    ["he-IL", "he"],
    ["iw", "he"],
    ["in", "id"],
    ["no", "nb"],
    ["nb-NO", "nb"],
    ["tl", "fil"],
    ["fil-PH", "fil"],
    ["pt", "pt-BR"],
    ["pt-BR", "pt-BR"],
    ["pt-PT", "pt-PT"],
    ["pt-AO", "pt-PT"],
    ["fr-CA", "fr-CA"],
    ["fr-BE", "fr"],
    ["de-AT", "de"],
    ["es-419", "es"],
    ["ja-JP-u-ca-japanese", "ja"],
    ["ar-u-nu-arab", "ar"],
    ["en-GB", "en"],
    ["xx", "en"],
    ["not a locale", "en"],
    [undefined, "en"],
  ])("resolves %s to the %s catalog", (locale, catalog) => {
    expect(messages(locale)).toBe(messages(catalog));
  });
  it("ships translations, not English, for the fallback targets", () => {
    for (const locale of ["zh-Hant", "zh-Hans", "he", "id", "nb", "fil", "pt-BR", "pt-PT", "fr-CA"])
      expect(messages(locale).respondkit_ask_anything()).not.toBe("Ask us anything");
  });
});
