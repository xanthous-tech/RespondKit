import {
  APICallError,
  JSONParseError,
  NoContentGeneratedError,
  NoObjectGeneratedError,
  TypeValidationError,
} from "ai";

export type TranslationErrorCode =
  | "aborted"
  | "configuration"
  | "invalid_input"
  | "invalid_output"
  | "provider_permanent"
  | "provider_retryable"
  | "unknown";

export interface TranslationErrorOptions {
  cause?: unknown;
  code: TranslationErrorCode;
  retryable: boolean;
  statusCode?: number;
}

/**
 * A stable error boundary for Workflow retry policy. Provider-specific errors do
 * not need to leak into the message workflow.
 */
export class TranslationError extends Error {
  readonly code: TranslationErrorCode;
  readonly retryable: boolean;
  readonly statusCode: number | undefined;

  constructor(message: string, options: TranslationErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "TranslationError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}

export class PlaceholderIntegrityError extends TranslationError {
  readonly duplicate: readonly string[];
  readonly missing: readonly string[];
  readonly unknown: readonly string[];

  constructor({
    duplicate,
    missing,
    unknown,
  }: {
    duplicate: readonly string[];
    missing: readonly string[];
    unknown: readonly string[];
  }) {
    const details = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : undefined,
      duplicate.length > 0 ? `duplicate: ${duplicate.join(", ")}` : undefined,
      unknown.length > 0 ? `unknown: ${unknown.join(", ")}` : undefined,
    ].filter((detail): detail is string => detail !== undefined);

    super(`Translation changed protected placeholders (${details.join("; ")})`, {
      code: "invalid_output",
      retryable: true,
    });
    this.name = "PlaceholderIntegrityError";
    this.duplicate = duplicate;
    this.missing = missing;
    this.unknown = unknown;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function apiErrorStatus(error: unknown): number | undefined {
  if (!APICallError.isInstance(error)) {
    return undefined;
  }

  return error.statusCode;
}

/** Classifies failures once; the AI SDK's internal retries stay disabled. */
export function classifyTranslationError(error: unknown): TranslationError {
  if (error instanceof TranslationError) {
    return error;
  }

  if (isAbortError(error)) {
    return new TranslationError("Translation was aborted", {
      cause: error,
      code: "aborted",
      retryable: false,
    });
  }

  if (
    NoObjectGeneratedError.isInstance(error) ||
    NoContentGeneratedError.isInstance(error) ||
    JSONParseError.isInstance(error) ||
    TypeValidationError.isInstance(error)
  ) {
    return new TranslationError("The model returned an invalid translation", {
      cause: error,
      code: "invalid_output",
      retryable: true,
    });
  }

  if (APICallError.isInstance(error)) {
    const statusCode = apiErrorStatus(error);
    const retryable =
      statusCode === undefined || statusCode === 408 || statusCode === 429 || statusCode >= 500;

    return new TranslationError(
      retryable
        ? "The translation provider is temporarily unavailable"
        : "The translation provider rejected the request",
      {
        cause: error,
        code: retryable ? "provider_retryable" : "provider_permanent",
        retryable,
        ...(statusCode === undefined ? {} : { statusCode }),
      },
    );
  }

  return new TranslationError("Translation failed unexpectedly", {
    cause: error,
    code: "unknown",
    retryable: false,
  });
}

export function isRetryableTranslationError(error: unknown): boolean {
  return classifyTranslationError(error).retryable;
}
