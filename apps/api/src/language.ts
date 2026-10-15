import { isLanguageQuery, languageLabel, resolveLanguageInput } from "@respondkit/discord";
import { createGeminiTranslationModel, resolveLanguageName } from "@respondkit/translation";
import type { Env } from "./env";

/** How long a Discord command waits for the model to place a language name (Discord allows 3 s in all). */
const MODEL_LOOKUP_MS = 2_000;

export class LanguageNotRecognized extends Error {}

/**
 * A language code or name as a canonical code: the local table first (codes, English and
 * native names), then the translation model for anything else ("Myanmar language").
 */
export async function resolveTranslationLanguage(
  env: Env,
  value: string,
  timeoutMs = MODEL_LOOKUP_MS,
): Promise<string> {
  const local = resolveLanguageInput(value);
  if (local !== null) return local;
  if (!isLanguageQuery(value)) throw new LanguageNotRecognized(notRecognized(value));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolveLanguageName(
        createGeminiTranslationModel({ apiKey: env.GEMINI_API_KEY, modelId: env.GEMINI_MODEL }),
        value.trim(),
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new LanguageNotRecognized(notRecognized(value))),
          timeoutMs,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof LanguageNotRecognized) throw error;
    throw new LanguageNotRecognized(notRecognized(value));
  } finally {
    clearTimeout(timer);
  }
}

function notRecognized(value: string): string {
  return `"${value.trim().slice(0, 35)}" is not a language RespondKit recognizes. Use a name such as Burmese or 简体中文, or a code such as my.`;
}

export { languageLabel };
