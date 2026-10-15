import { expect, it } from "vite-plus/test";
import { compileAndroidResources } from "./index";

const plural = (match: Record<string, string>) => [
  {
    declarations: ["input count", "local category = count: plural"],
    selectors: ["category"],
    match,
  },
];

it("escapes Android text and XML while retaining whitespace and literal percents", () => {
  const output = compileAndroidResources({
    sourceLocale: "en",
    catalogs: {
      en: {
        greeting: '  @Hi "{name}" & <ok>\nIt\'s 100%  ',
        literal: "100% done",
      },
    },
  })["values/strings.xml"]!;
  expect(output).toContain(
    '<string name="greeting">"  @Hi \\"%1$s\\" &amp; &lt;ok&gt;\\nIt\\\'s 100%%  "</string>',
  );
  expect(output).toContain('<string name="literal" formatted="false">"100% done"</string>');
});
it("emits default fallback and preserves language, script, and region qualifiers", () => {
  const output = compileAndroidResources({
    sourceLocale: "en",
    catalogs: {
      en: { hi: "Hi" },
      fr: { hi: "Salut" },
      "zh-Hant": { hi: "你好" },
      "pt-BR": { hi: "Oi" },
      he: { hi: "שלום" },
      id: { hi: "Hai" },
      nb: { hi: "Hei" },
    },
  });
  expect(Object.keys(output)).toEqual([
    "values/strings.xml",
    "values-fr/strings.xml",
    "values-iw/strings.xml",
    "values-in/strings.xml",
    "values-nb/strings.xml",
    "values-no/strings.xml",
    "values-b+pt+BR/strings.xml",
    "values-b+zh+Hant/strings.xml",
  ]);
});
it("writes actual cardinal categories rather than treating zero as an exact count", () => {
  const output = compileAndroidResources({
    sourceLocale: "en",
    catalogs: {
      en: {
        new_messages: [
          {
            declarations: ["input count", "local category = count: plural"],
            match: {
              "category=zero": "Zero",
              "category=one": "{count} new message",
              "category=*": "{count} new messages",
            },
          },
        ],
      },
    },
  })["values/strings.xml"]!;
  expect(output).toContain('<item quantity="one">"%1$d new message"</item>');
  expect(output).toContain('<item quantity="other">"%1$d new messages"</item>');
  expect(output).not.toContain('quantity="zero"');
});
it("keeps the Hebrew many quantity that older Android ICU still selects", () => {
  const output = compileAndroidResources({
    sourceLocale: "en",
    catalogs: {
      en: { count: plural({ "category=one": "{count} file", "category=*": "{count} files" }) },
      he: { count: plural({ "category=one": "קובץ {count}", "category=*": "{count} קבצים" }) },
    },
  })["values-iw/strings.xml"]!;
  expect(output).toContain('<item quantity="many">"%1$d קבצים"</item>');
});
