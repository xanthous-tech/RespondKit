/** The deliberately small inlang message-format subset shared by both native exporters. */
export interface ResourceInput {
  readonly sourceLocale: string;
  readonly catalogs: Readonly<Record<string, unknown>>;
}
export type Category = Intl.LDMLPluralRule;
export interface Pattern {
  readonly text: string;
  readonly parameters: readonly string[];
}
export type Message =
  | { readonly kind: "text"; readonly pattern: Pattern }
  | {
      readonly kind: "plural";
      readonly count: string;
      readonly forms: Readonly<Partial<Record<Category, Pattern>>>;
    };
export interface ResourceProject {
  readonly sourceLocale: string;
  readonly locales: readonly string[];
  readonly keys: readonly string[];
  readonly catalogs: Readonly<Record<string, Readonly<Record<string, Message>>>>;
}
const identifier = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const categories = new Set(["zero", "one", "two", "few", "many", "other"]);

function fail(location: string, reason: string): never {
  throw new Error(`${location}: ${reason}`);
}
function object(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(location, "expected an object");
  }
  return value as Record<string, unknown>;
}
function localeName(value: string): string {
  // Native resource directories cannot represent arbitrary BCP 47 extensions/variants.
  if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z]{4})?(?:-(?:[a-zA-Z]{2}|\d{3}))?$/.test(value)) {
    fail(value, "use a language with optional script and region (for example zh-Hant-TW)");
  }
  const locale = Intl.getCanonicalLocales(value)[0]!;
  if (Intl.PluralRules.supportedLocalesOf([locale]).length === 0) {
    fail(value, "locale is unavailable in this Node/ICU build");
  }
  return locale;
}
function pattern(value: unknown, location: string): Pattern {
  if (typeof value !== "string") fail(location, "expected a string pattern");
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (
      character === "\\" ||
      (code < 32 && ![9, 10, 13].includes(code)) ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0xfffe ||
      code === 0xffff
    ) {
      fail(location, "backslash escapes or invalid text are outside the portable subset");
    }
  }
  const parameters = new Set<string>();
  const remainder = value.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, name: string) => {
    parameters.add(name);
    return "";
  });
  if (/[{}]/.test(remainder)) {
    fail(
      location,
      "only {name} placeholders are supported; no markup, expressions, or literal braces",
    );
  }
  return { text: value, parameters: [...parameters].sort() };
}
function message(value: unknown, locale: string, location: string): Message {
  if (typeof value === "string") return { kind: "text", pattern: pattern(value, location) };
  if (!Array.isArray(value) || value.length !== 1) {
    fail(location, "use a string or a single cardinal-plural declaration");
  }
  const entry = object(value[0], location);
  for (const key of Object.keys(entry)) {
    if (!["declarations", "selectors", "match"].includes(key))
      fail(location, `unsupported field ${key}`);
  }
  const declarations = entry.declarations;
  if (
    !Array.isArray(declarations) ||
    declarations.length !== 2 ||
    declarations.some((d) => typeof d !== "string")
  ) {
    fail(location, "plural needs exactly 'input count' and 'local category = count: plural'");
  }
  const input = /^input ([a-zA-Z_][a-zA-Z0-9_]*)$/.exec(declarations[0]);
  const selector = /^local ([a-zA-Z_][a-zA-Z0-9_]*) = ([a-zA-Z_][a-zA-Z0-9_]*): plural$/.exec(
    declarations[1],
  );
  if (!input || !selector || input[1] !== selector[2] || input[1] === selector[1]) {
    fail(location, "only one integer cardinal plural is supported (no formatter options)");
  }
  const count = input[1]!;
  const category = selector[1]!;
  if (
    entry.selectors !== undefined &&
    (!Array.isArray(entry.selectors) ||
      entry.selectors.length !== 1 ||
      entry.selectors[0] !== category)
  ) {
    fail(location, "selectors must contain only the declared plural category");
  }
  const matches = object(entry.match, location);
  const branches = new Map<string, Pattern>();
  for (const [key, text] of Object.entries(matches)) {
    const prefix = `${category}=`;
    const form = key.slice(prefix.length);
    if (!key.startsWith(prefix) || (!categories.has(form) && form !== "*")) {
      fail(location, `unsupported match ${key}; use cardinal categories or *`);
    }
    const parsed = pattern(text, `${location}/${key}`);
    if (parsed.parameters.some((parameter) => parameter !== count)) {
      fail(location, "a plural may interpolate only its count");
    }
    branches.set(form, parsed);
  }
  // Paraglide matches in insertion order. A wildcard before a category would shadow it.
  if (branches.has("*") && [...branches.keys()].at(-1) !== "*") {
    fail(location, "put the wildcard match last");
  }
  const forms: Partial<Record<Category, Pattern>> = {};
  for (const form of new Intl.PluralRules(locale, { type: "cardinal" }).resolvedOptions()
    .pluralCategories) {
    const selected = branches.get(form) ?? branches.get("*");
    if (!selected)
      fail(location, `missing ${form} plural; add it or a final ${category}=* fallback`);
    forms[form] = selected;
  }
  return { kind: "plural", count, forms };
}
function signature(value: Message): string {
  return value.kind === "text"
    ? `text:${value.pattern.parameters.join(",")}`
    : `plural:${value.count}`;
}

/** Validate every catalog before writing anything. No implicit missing-key fallback. */
export function parseResources(input: ResourceInput): ResourceProject {
  const sourceLocale = localeName(input.sourceLocale);
  const catalogs: Record<string, Record<string, Message>> = Object.create(null);
  for (const [rawLocale, rawCatalog] of Object.entries(input.catalogs)) {
    const locale = localeName(rawLocale);
    if (catalogs[locale]) fail(locale, "duplicate locale after canonicalization");
    const catalog = object(rawCatalog, locale);
    const messages: Record<string, Message> = Object.create(null);
    for (const key of Object.keys(catalog).sort()) {
      if (key === "$schema") {
        if (typeof catalog[key] !== "string") fail(locale, "$schema must be a URL string");
        continue;
      }
      if (!/^[a-z][a-z0-9_]*$/.test(key))
        fail(`${locale}/${key}`, "message IDs must be lower_snake_case");
      messages[key] = message(catalog[key], locale, `${locale}/${key}`);
    }
    catalogs[locale] = messages;
  }
  const source = catalogs[sourceLocale];
  if (!source) fail(sourceLocale, "source locale catalog is missing");
  const keys = Object.keys(source);
  if (keys.length === 0) fail(sourceLocale, "catalog is empty");
  for (const [locale, catalog] of Object.entries(catalogs)) {
    if (Object.keys(catalog).join("\n") !== keys.join("\n"))
      fail(locale, "message IDs must match the source catalog exactly");
    for (const key of keys) {
      if (signature(catalog[key]!) !== signature(source[key]!)) {
        fail(`${locale}/${key}`, "message kind and parameter names must match the source catalog");
      }
    }
  }
  return { sourceLocale, locales: Object.keys(catalogs).sort(), keys, catalogs };
}

/** Stable positions are based on sorted parameter names, independent of translation word order. */
export function formatPattern(value: Pattern, platform: "ios" | "android", count?: string): string {
  const formatted = count !== undefined || value.parameters.length > 0;
  const text = formatted ? value.text.replaceAll("%", "%%") : value.text;
  return text.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, name: string) => {
    if (!identifier.test(name)) throw new Error("Invalid parameter");
    const position = count ? 1 : value.parameters.indexOf(name) + 1;
    const type = count ? (platform === "ios" ? "lld" : "d") : platform === "ios" ? "@" : "s";
    return `%${position}$${type}`;
  });
}
