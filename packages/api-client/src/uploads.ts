import { AttachmentV1Schema, UploadV1Schema, type AttachmentV1 } from "@respondkit/protocol";
import type { RespondKitClientOptions } from "./client";

/** Read only the requested slice; native implementations should not load the entire file. */
export interface UploadSource {
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
  read(offset: number, length: number): Promise<Blob | Uint8Array<ArrayBuffer>>;
}
export interface UploadOptions {
  readonly clientUploadId: string;
  readonly getToken: () => Promise<string>;
  readonly signal?: AbortSignal | undefined;
  readonly onProgress?: ((sent: number, total: number) => void) | undefined;
}
/** Retry with the same clientUploadId and file. Completed uploads return without re-uploading. */
export async function uploadAttachment(
  options: RespondKitClientOptions,
  source: UploadSource,
  upload: UploadOptions,
): Promise<AttachmentV1> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const base = options.baseUrl.replace(/\/$/, "");
  async function request(path: string, method: string, body?: BodyInit) {
    upload.signal?.throwIfAborted();
    const token = await upload.getToken();
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Content-Type", method === "PUT" ? "application/octet-stream" : "application/json");
    const response = await fetcher(`${base}/v1/attachments${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      ...(upload.signal ? { signal: upload.signal } : {}),
    });
    const value = (await response.json()) as { error?: { message?: string } };
    if (!response.ok) throw new Error(value.error?.message ?? `Upload failed (${response.status})`);
    return value;
  }
  const created = UploadV1Schema.parse(
    await request(
      "",
      "POST",
      JSON.stringify({
        clientUploadId: upload.clientUploadId,
        name: source.name,
        size: source.size,
        contentType: source.contentType || "application/octet-stream",
      }),
    ),
  );
  if (created.completed) {
    upload.onProgress?.(source.size, source.size);
    return created.completed;
  }
  for (let offset = 0, part = 1; offset < source.size; offset += created.partSize, part++) {
    const count = Math.min(created.partSize, source.size - offset);
    const data = await source.read(offset, count);
    if ((data instanceof Uint8Array ? data.byteLength : data.size) !== count)
      throw new Error("File changed while uploading. Select it again.");
    await request(`/${created.id}/parts/${part}`, "PUT", data);
    upload.onProgress?.(offset + count, source.size);
  }
  const complete = AttachmentV1Schema.parse(await request(`/${created.id}/complete`, "POST"));
  upload.onProgress?.(source.size, source.size);
  return complete;
}
export function fileUploadSource(file: Blob & { name: string }): UploadSource {
  return {
    name: file.name,
    size: file.size,
    contentType: file.type,
    read: async (offset, length) => file.slice(offset, offset + length),
  };
}
