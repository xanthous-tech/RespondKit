/**
 * Language input for /reply, /translate, /retranslate and the agent API's
 * `translate` field: a BCP 47 code as before, or a language name in English
 * or in the language itself ("Burmese", "Myanmar", "简体中文"), so operators
 * need not know the codes. Names this table cannot place are resolved by the
 * translation model in the API (see resolveTranslationLanguage there).
 */

const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

/** Languages whose English and native names are recognized without a model call. */
const KNOWN_CODES = [
  "af",
  "am",
  "ar",
  "az",
  "be",
  "bg",
  "bn",
  "bs",
  "ca",
  "cs",
  "cy",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "eu",
  "fa",
  "fi",
  "fil",
  "fr",
  "ga",
  "gl",
  "gu",
  "ha",
  "he",
  "hi",
  "hr",
  "hu",
  "hy",
  "id",
  "ig",
  "is",
  "it",
  "ja",
  "jv",
  "ka",
  "kk",
  "km",
  "kn",
  "ko",
  "ku",
  "ky",
  "lo",
  "lt",
  "lv",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "ne",
  "nl",
  "no",
  "or",
  "pa",
  "pl",
  "ps",
  "pt",
  "ro",
  "ru",
  "si",
  "sk",
  "sl",
  "so",
  "sq",
  "sr",
  "sv",
  "sw",
  "ta",
  "te",
  "tg",
  "th",
  "tk",
  "tr",
  "uk",
  "ur",
  "uz",
  "vi",
  "xh",
  "yo",
  "yue",
  "zh",
  "zu",
] as const;

/** Names Intl does not produce, or that should pick a script or region. */
const ALIASES: Record<string, string> = {
  myanmar: "my",
  "myanmar language": "my",
  burmese: "my",
  chinese: "zh",
  mandarin: "zh",
  "simplified chinese": "zh-Hans",
  "chinese simplified": "zh-Hans",
  简体中文: "zh-Hans",
  简体: "zh-Hans",
  中文: "zh",
  "traditional chinese": "zh-Hant",
  "chinese traditional": "zh-Hant",
  繁體中文: "zh-Hant",
  繁体中文: "zh-Hant",
  繁體: "zh-Hant",
  cantonese: "yue",
  廣東話: "yue",
  粤语: "yue",
  粵語: "yue",
  tagalog: "fil",
  filipino: "fil",
  farsi: "fa",
  persian: "fa",
  "brazilian portuguese": "pt-BR",
  "portuguese (brazil)": "pt-BR",
  "european portuguese": "pt-PT",
  "latin american spanish": "es-419",
  "mexican spanish": "es-MX",
  norwegian: "no",
  bahasa: "id",
  "bahasa indonesia": "id",
  "bahasa melayu": "ms",
  malay: "ms",
};

function key(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replaceAll(/\s+/g, " ");
}

let table: Map<string, string> | undefined;

function names(): Map<string, string> {
  if (table !== undefined) return table;
  table = new Map();
  for (const code of KNOWN_CODES) {
    for (const locale of ["en", code]) {
      try {
        const name = new Intl.DisplayNames([locale], { type: "language" }).of(code);
        if (name !== undefined && name !== code) table.set(key(name), code);
      } catch {
        // A runtime without this locale's names still knows the English ones.
      }
    }
  }
  for (const [name, code] of Object.entries(ALIASES)) table.set(key(name), code);
  return table;
}

/** A canonical code for a code-shaped value, or null when it is not a valid language tag. */
export function languageCode(value: string): string | null {
  if (!LANGUAGE_CODE_PATTERN.test(value) || value.length > 35) return null;
  try {
    return new Intl.Locale(value).baseName;
  } catch {
    return null;
  }
}

/**
 * The code for a language code or a known name, or null when only the
 * translation model can tell. A name that happens to look like a code
 * ("Thai" is not a code; "my" is) is read as the code.
 */
export function resolveLanguageInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return names().get(key(trimmed)) ?? languageCode(trimmed);
}

/** "Burmese (my)" for operator-facing messages. */
export function languageLabel(code: string): string {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "language" }).of(code);
    return name !== undefined && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

/** A free-text language name sent to the model: printable, short, no markup. */
export function isLanguageQuery(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.length <= 35 && /^[\p{L}\p{M}\s().'-]+$/u.test(trimmed);
}
