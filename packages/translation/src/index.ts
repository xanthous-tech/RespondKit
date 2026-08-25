export {
  classifyTranslationError,
  isRetryableTranslationError,
  PlaceholderIntegrityError,
  TranslationError,
  type TranslationErrorCode,
  type TranslationErrorOptions,
} from "./errors";
export {
  DEFAULT_GEMINI_MODEL_ID,
  createGeminiTranslationModel,
  type GeminiTranslationModelOptions,
} from "./gemini";
export {
  maskProtectedText,
  restoreProtectedText,
  validateProtectedPlaceholders,
  type MaskedText,
  type PlaceholderValidation,
  type ProtectedFragment,
  type ProtectedFragmentKind,
} from "./masking";
export {
  TRANSLATION_PROMPT_VERSION,
  createTranslator,
  translateMessage,
  translationOutputSchema,
  type TranslateMessageInput,
  type TranslationContextTurn,
  type TranslationGlossaryEntry,
  type TranslationResult,
  type Translator,
  type TranslatorOptions,
} from "./translator";
