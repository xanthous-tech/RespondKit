import { createGoogle } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

import { TranslationError } from "./errors";

export const DEFAULT_GEMINI_MODEL_ID = "gemini-3.1-flash-lite";

export interface GeminiTranslationModelOptions {
  apiKey: string;
  modelId?: string;
}

/**
 * Creates a model only when a caller supplies a key. This module never reads
 * process.env or creates a provider singleton at import time.
 */
export function createGeminiTranslationModel({
  apiKey,
  modelId = DEFAULT_GEMINI_MODEL_ID,
}: GeminiTranslationModelOptions): LanguageModel {
  if (apiKey.trim().length === 0) {
    throw new TranslationError("A Gemini API key is required", {
      code: "configuration",
      retryable: false,
    });
  }

  const google = createGoogle({ apiKey });
  return google(modelId);
}
