import { z } from "zod";
export const AttachmentIdSchema = z.string().regex(/^att_[a-f0-9]{64}$/);
export const AttachmentV1Schema = z.strictObject({
  id: AttachmentIdSchema,
  name: z.string().min(1).max(1024),
  contentType: z.string().min(1).max(255),
  size: z.number().int().nonnegative().safe(),
  downloadUrl: z.url().refine((value) => /^https?:\/\//.test(value)),
});
export type AttachmentV1 = z.infer<typeof AttachmentV1Schema>;
export const CreateUploadRequestSchema = z.strictObject({
  clientUploadId: z.string().min(1).max(128),
  name: z
    .string()
    .min(1)
    .max(1024)
    .regex(/^[^\r\n]+$/)
    .refine((value) => !value.includes(String.fromCharCode(0))),
  contentType: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[^\r\n]+$/),
  size: z.number().int().nonnegative().safe(),
});
export const UploadV1Schema = z.strictObject({
  id: AttachmentIdSchema,
  partSize: z.number().int().positive(),
  completed: AttachmentV1Schema.optional(),
});
export type UploadV1 = z.infer<typeof UploadV1Schema>;
