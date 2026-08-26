import { z } from "zod";

export const ApiErrorCodeSchema = z.enum([
  "invalid_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "acceptance_unknown",
  "unavailable",
  "internal_error",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorV1Schema = z
  .object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
    requestId: z.string().min(1).max(128).optional(),
  })
  .strict();
export type ApiErrorV1 = z.infer<typeof ApiErrorV1Schema>;

export const ApiErrorResponseV1Schema = z
  .object({
    error: ApiErrorV1Schema,
  })
  .strict();
export type ApiErrorResponseV1 = z.infer<typeof ApiErrorResponseV1Schema>;
