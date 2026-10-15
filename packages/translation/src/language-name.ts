import { generateText, Output, type LanguageModel } from "ai";
import { z } from "zod";

import { TranslationError } from "./errors";

const languageNameSchema = z.object({
  code: z
    .string()
    .nullable()
    .describe(
      "The BCP 47 language tag, such as my, zh-Hans or pt-BR, or null when it is not a language",
    ),
});

/**
 * Maps a language name an operator typed ("Myanmar language", "Kreyòl") to a
 * BCP 47 tag with the translation model. The answer is a strict JSON object and
 * is validated as a real language tag; anything else is an error, never a guess.
 */
export async function resolveLanguageName(model: LanguageModel, query: string): Promise<string> {
  const result = await generateText({
    instructions:
      "You map the name of a human language, written in any language, to its BCP 47 tag. Answer null if the text does not name a human language. Never translate or explain.",
    maxRetries: 0,
    model,
    output: Output.object({ name: "LanguageTag", schema: languageNameSchema }),
    prompt: JSON.stringify({ languageName: query }),
  });
  const code = result.output.code;
  if (code !== null) {
    try {
      const tag = new Intl.Locale(code).baseName;
      const name = new Intl.DisplayNames(["en"], { type: "language" }).of(tag);
      if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(tag) && name !== undefined && name !== tag)
        return tag;
    } catch {
      // Fall through to the error below.
    }
  }
  throw new TranslationError(`"${query}" is not a language name the translator recognizes`, {
    code: "invalid_input",
    retryable: false,
  });
}
