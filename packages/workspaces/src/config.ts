import {
  InboxIdSchema,
  InstallationIdSchema,
  JsonValueSchema,
  LanguageTagSchema,
  VisitorIdSchema,
  WorkspaceIdSchema,
} from "@agent-chat/protocol";
import { z } from "zod";

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const internalIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9_-]+$/);

export function normalizeOrigin(value: string): string {
  const url = new URL(value);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("Allowed origins must use HTTP or HTTPS");
  }

  if (url.username !== "" || url.password !== "") {
    throw new TypeError("Allowed origins cannot contain credentials");
  }

  if ((url.pathname !== "" && url.pathname !== "/") || url.search !== "" || url.hash !== "") {
    throw new TypeError("Allowed origins cannot contain a path, query, or fragment");
  }

  return url.origin;
}

export const allowedOriginConfigSchema = z
  .string()
  .min(8)
  .max(2048)
  .transform((value, context) => {
    try {
      return normalizeOrigin(value);
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid origin",
      });

      return z.NEVER;
    }
  });

const metadataSchema = z
  .record(z.string().min(1).max(64), JsonValueSchema)
  .refine((value) => Object.keys(value).length <= 32, {
    message: "Visitor metadata may contain at most 32 keys",
  })
  .refine((value) => JSON.stringify(value).length <= 16_384, {
    message: "Visitor metadata must serialize to at most 16 KiB",
  });

export const visitorContextSchema = z.strictObject({
  id: VisitorIdSchema,
  installationId: InstallationIdSchema,
  externalUserId: z.string().trim().min(1).max(512).nullish(),
  email: z.string().trim().email().max(320).nullish(),
  posthogDistinctId: z.string().trim().min(1).max(512).nullish(),
  locale: LanguageTagSchema.nullish(),
  timezone: z.string().trim().min(1).max(64).nullish(),
  region: z.string().trim().min(2).max(80).nullish(),
  userAgent: z.string().trim().min(1).max(1024).nullish(),
  metadata: metadataSchema.optional(),
});

export const inboxConfigurationSchema = z.strictObject({
  id: InboxIdSchema,
  name: z.string().trim().min(1).max(160),
  defaultLocale: LanguageTagSchema.optional(),
  allowedOrigins: z.array(allowedOriginConfigSchema).min(1).max(100),
});

export const productConfigurationSchema = z.strictObject({
  id: internalIdSchema,
  slug: slugSchema,
  name: z.string().trim().min(1).max(160),
  inboxes: z.array(inboxConfigurationSchema).min(1).max(100),
});

export const workspaceConfigurationSchema = z.strictObject({
  id: WorkspaceIdSchema,
  slug: slugSchema,
  name: z.string().trim().min(1).max(160),
  products: z.array(productConfigurationSchema).min(1).max(100),
});

export type VisitorContext = z.infer<typeof visitorContextSchema>;
export type InboxConfiguration = z.infer<typeof inboxConfigurationSchema>;
export type ProductConfiguration = z.infer<typeof productConfigurationSchema>;
export type WorkspaceConfiguration = z.infer<typeof workspaceConfigurationSchema>;
