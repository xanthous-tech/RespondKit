export interface CustomerProjectionContent {
  readonly originalText: string;
  readonly sourceLanguage: string;
  readonly translatedText: string;
  readonly needsReview: boolean;
}

export interface OperatorReplyAuditContent {
  readonly originalText: string;
  readonly targetLanguage: string;
  readonly translatedText: string;
  readonly needsReview: boolean;
}

const englishLanguageNames = new Intl.DisplayNames(["en"], {
  fallback: "none",
  type: "language",
});

/** Converts a stored BCP-47 tag such as `my-MM` to its English language name. */
export function languageDisplayName(languageTag: string): string {
  const normalized = languageTag.trim().replaceAll("_", "-");
  if (normalized.length === 0) return "Unknown language";

  try {
    const language = new Intl.Locale(normalized).language;
    return englishLanguageNames.of(language) ?? normalized;
  } catch {
    return normalized;
  }
}

function discordSubtext(text: string): string {
  return text
    .split("\n")
    .map((line) => `-# ${line.length === 0 ? "\u200b" : line}`)
    .join("\n");
}

export function formatCustomerProjectionContent(input: CustomerProjectionContent): string {
  const sourceLanguage = languageDisplayName(input.sourceLanguage);
  return [
    `**Customer · ${sourceLanguage} → English**`,
    input.needsReview
      ? "⚠️ **Translation needs review.** Check the original message before acting."
      : undefined,
    input.translatedText,
    "",
    discordSubtext(`Original in ${sourceLanguage}\n${input.originalText}`),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function formatOperatorReplyAuditContent(input: OperatorReplyAuditContent): string {
  const targetLanguage = languageDisplayName(input.targetLanguage);
  return [
    `**Reply sent · English → ${targetLanguage}**`,
    input.needsReview
      ? "⚠️ **Translation needs review.** Check the customer-facing text."
      : undefined,
    input.originalText,
    "",
    discordSubtext(`Customer received in ${targetLanguage}\n${input.translatedText}`),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}
