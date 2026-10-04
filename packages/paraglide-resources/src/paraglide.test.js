// The pinned message-format plugin ships JavaScript without declarations.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { compileMessage } from "@inlang/paraglide-js";
import plugin from "@inlang/plugin-message-format";
import { expect, it } from "vite-plus/test";
import { parseResources } from "./index";

async function functions(catalog, locale) {
  const imported = await plugin.importFiles({
    files: [{ locale, content: new TextEncoder().encode(JSON.stringify(catalog)) }],
  });
  return Object.fromEntries(
    imported.messages.map((message) => {
      const bundle = imported.bundles.find((candidate) => candidate.id === message.bundleId);
      const variants = imported.variants.filter(
        (variant) => variant.messageBundleId === message.bundleId,
      );
      // compileMessage only reads locale/selectors/patterns. No database or network is needed.
      const compiled = compileMessage(bundle.declarations, message, variants);
      return [
        message.bundleId,
        runInNewContext(`(${compiled.code.replace(/;\s*$/, "")})`, {
          registry: {
            plural: (language, count, options) =>
              new Intl.PluralRules(language, options).select(count),
          },
        }),
      ];
    }),
  );
}
function render(pattern, inputs) {
  return pattern.text.replace(/\{(\w+)\}/g, (_, key) => String(inputs[key]));
}
it.each(["en", "ar", "ru", "pl", "fr", "zh-Hant"])(
  "matches real Paraglide cardinal selection in %s",
  async (locale) => {
    const catalog = {
      items: [
        {
          declarations: ["input count", "local category = count: plural"],
          selectors: ["category"],
          match: {
            "category=zero": "zero {count}",
            "category=one": "one {count}",
            "category=two": "two {count}",
            "category=few": "few {count}",
            "category=many": "many {count}",
            "category=*": "other {count}",
          },
        },
      ],
    };
    const actual = (await functions(catalog, locale)).items;
    const message = parseResources({ sourceLocale: locale, catalogs: { [locale]: catalog } })
      .catalogs[locale].items;
    for (const count of [0, 1, 2, 3, 5, 11, 21, 100, 101, 102, 1000, 1000000, 2147483647]) {
      const category = new Intl.PluralRules(locale).select(count);
      expect(render(message.forms[category], { count })).toBe(actual({ count }));
    }
  },
);
it("expands a wildcard exactly as Paraglide does", async () => {
  const catalog = {
    items: [
      {
        declarations: ["input count", "local category = count: plural"],
        match: {
          "category=one": "One",
          "category=*": "{count} items",
        },
      },
    ],
  };
  const actual = (await functions(catalog, "ar")).items;
  const message = parseResources({ sourceLocale: "ar", catalogs: { ar: catalog } }).catalogs.ar
    .items;
  for (const count of [0, 1, 2, 5, 11, 100]) {
    expect(render(message.forms[new Intl.PluralRules("ar").select(count)], { count })).toBe(
      actual({ count }),
    );
  }
});
it("accepts every real English UI catalog entry in both parsers", async () => {
  const catalog = JSON.parse(
    readFileSync(new URL("../../../localization/messages/en.json", import.meta.url), "utf8"),
  );
  const actual = await functions(catalog, "en");
  const project = parseResources({ sourceLocale: "en", catalogs: { en: catalog } });
  for (const key of project.keys) {
    const message = project.catalogs.en[key];
    const inputs =
      message.kind === "text"
        ? Object.fromEntries(message.pattern.parameters.map((name) => [name, `${name} value`]))
        : { [message.count]: 3 };
    const pattern = message.kind === "text" ? message.pattern : message.forms.other;
    expect(render(pattern, inputs)).toBe(actual[key](inputs));
  }
});
