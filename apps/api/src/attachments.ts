import {
  AttachmentIdSchema,
  CreateUploadRequestSchema,
  type AttachmentV1,
} from "@respondkit/protocol";
import type { Hono, Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Env } from "./env";
import type { MessageWorkflowEnvelope } from "./workflows/envelope";

type Scope = { workspaceId: string; inboxId: string; visitorId: string };
type Bindings = { Bindings: Env; Variables: { corsOrigin?: string } };
type Row = {
  id: string;
  workspace_id: string;
  inbox_id: string;
  visitor_id: string;
  object_key: string;
  download_token: string;
  download_url: string;
  name: string;
  content_type: string;
  size: number;
  upload_id: string;
  part_size: number;
  status: string;
  message_id: string | null;
};
const dto = (row: Row): AttachmentV1 => ({
  id: row.id,
  name: row.name,
  contentType: row.content_type,
  size: row.size,
  downloadUrl: row.download_url,
});
const fail = (status: 400 | 404 | 409 | 503, message: string): never => {
  throw new HTTPException(status, { message });
};
function bucket(env: Env) {
  return env.ATTACHMENTS ?? fail(503, "Attachments are not configured.");
}
async function owned(env: Env, scope: Scope, id: string) {
  AttachmentIdSchema.parse(id);
  const row = await env.DB.prepare(
    "SELECT * FROM attachment WHERE id=? AND workspace_id=? AND inbox_id=? AND visitor_id=?",
  )
    .bind(id, scope.workspaceId, scope.inboxId, scope.visitorId)
    .first<Row>();
  return row ?? fail(404, "Upload not found.");
}
async function hash(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function registerAttachmentRoutes(
  app: Hono<Bindings>,
  authenticate: (context: Context<Bindings>) => Promise<Scope>,
) {
  app.post("/v1/attachments", async (c) => {
    const scope = await authenticate(c);
    const input = CreateUploadRequestSchema.parse(await c.req.json());
    const id = `att_${await hash(JSON.stringify([scope.workspaceId, scope.inboxId, scope.visitorId, input.clientUploadId]))}`;
    let row = await c.env.DB.prepare("SELECT * FROM attachment WHERE id=?").bind(id).first<Row>();
    if (!row) {
      const key = `${scope.workspaceId}/${scope.inboxId}/${id}`;
      const token =
        crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
      const upload = await bucket(c.env).createMultipartUpload(key, {
        httpMetadata: { contentType: "application/octet-stream" },
      });
      // Scale part sizes for R2's 10,000-part ceiling without imposing a product file-size cap.
      const unit = 8 * 1024 * 1024;
      const partSize = Math.max(unit, Math.ceil(input.size / 10000 / unit) * unit);
      await c.env.DB.prepare(`INSERT OR IGNORE INTO attachment
        (id,workspace_id,inbox_id,visitor_id,object_key,download_token,download_url,name,content_type,size,upload_id,part_size)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(
          id,
          scope.workspaceId,
          scope.inboxId,
          scope.visitorId,
          key,
          token,
          new URL(`/v1/files/${token}`, c.req.url).toString(),
          input.name,
          input.contentType,
          input.size,
          upload.uploadId,
          partSize,
        )
        .run();
      row = await owned(c.env, scope, id);
      if (row.upload_id !== upload.uploadId) await upload.abort();
    }
    if (
      row.name !== input.name ||
      row.size !== input.size ||
      row.content_type !== input.contentType
    )
      fail(409, "This upload ID already belongs to another file.");
    if (row.status === "aborted") fail(409, "This upload was cancelled.");
    return c.json({
      id,
      partSize: row.part_size,
      ...(row.status === "ready" ? { completed: dto(row) } : {}),
    });
  });
  app.put("/v1/attachments/:id/parts/:part", async (c) => {
    const row = await owned(c.env, await authenticate(c), c.req.param("id"));
    const part = z.coerce.number().int().min(1).max(10000).parse(c.req.param("part"));
    if (row.status !== "uploading") fail(409, "Upload is not writable.");
    const expected = Math.min(row.part_size, row.size - (part - 1) * row.part_size);
    if (expected <= 0 || Number(c.req.header("Content-Length")) !== expected || !c.req.raw.body)
      fail(400, "The upload part length does not match the file.");
    const result = await bucket(c.env)
      .resumeMultipartUpload(row.object_key, row.upload_id)
      .uploadPart(part, c.req.raw.body!);
    await c.env.DB.prepare(
      "INSERT INTO attachment_part (attachment_id,part_number,etag) VALUES (?,?,?) ON CONFLICT(attachment_id,part_number) DO UPDATE SET etag=excluded.etag",
    )
      .bind(row.id, part, result.etag)
      .run();
    return c.json({ ok: true });
  });
  app.post("/v1/attachments/:id/complete", async (c) => {
    const row = await owned(c.env, await authenticate(c), c.req.param("id"));
    if (row.status === "aborted") fail(409, "Upload was cancelled.");
    const r2 = bucket(c.env);
    if (row.status !== "ready") {
      let object = await r2.head(row.object_key);
      if (!object) {
        if (row.size === 0) {
          await r2.put(row.object_key, new Uint8Array());
          await r2.resumeMultipartUpload(row.object_key, row.upload_id).abort();
        } else {
          const parts = await c.env.DB.prepare(
            "SELECT part_number AS partNumber,etag FROM attachment_part WHERE attachment_id=? ORDER BY part_number",
          )
            .bind(row.id)
            .all<R2UploadedPart>();
          if (
            parts.results.length !== Math.ceil(row.size / row.part_size) ||
            parts.results.some((p, i) => p.partNumber !== i + 1)
          )
            fail(409, "Some upload parts are missing.");
          await r2.resumeMultipartUpload(row.object_key, row.upload_id).complete(parts.results);
        }
        object = await r2.head(row.object_key);
      }
      if (object?.size !== row.size) fail(409, "Uploaded size does not match the file.");
      await c.env.DB.prepare(
        "UPDATE attachment SET status='ready' WHERE id=? AND status='uploading'",
      )
        .bind(row.id)
        .run();
    }
    return c.json(dto(row));
  });
  app.delete("/v1/attachments/:id", async (c) => {
    const row = await owned(c.env, await authenticate(c), c.req.param("id"));
    if (row.status === "uploading") {
      await bucket(c.env).resumeMultipartUpload(row.object_key, row.upload_id).abort();
      await c.env.DB.prepare(
        "UPDATE attachment SET status='aborted' WHERE id=? AND status='uploading'",
      )
        .bind(row.id)
        .run();
    }
    return c.json({ ok: true });
  });
  // Opaque, non-expiring capability URLs work in the customer transcript and private Discord thread.
  // Objects remain in a private bucket and are always downloaded, never executed on the API origin.
  app.get("/v1/files/:token", async (c) => {
    const token = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(c.req.param("token"));
    const row = await c.env.DB.prepare(
      "SELECT * FROM attachment WHERE download_token=? AND status='ready' AND message_id IS NOT NULL",
    )
      .bind(token)
      .first<Row>();
    if (!row) return c.notFound();
    const object = await bucket(c.env).get(row.object_key);
    if (!object) return c.notFound();
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(object.size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.name).replace(/'/g, "%27")}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  });
}
export async function resolveAttachments(env: Env, scope: Scope, ids: string[], messageId: string) {
  if (new Set(ids).size !== ids.length) fail(400, "Duplicate attachment IDs.");
  const rows = await Promise.all(ids.map((id) => owned(env, scope, id)));
  if (
    rows.some(
      (row) => row.status !== "ready" || (row.message_id !== null && row.message_id !== messageId),
    )
  )
    fail(409, "An attachment is unfinished or belongs to another message.");
  return rows.map(dto);
}
/** Persist the immutable attachment envelope before asynchronous workflow acceptance. */
export async function persistAttachmentIngress(env: Env, envelope: MessageWorkflowEnvelope) {
  if (envelope.direction !== "customer_to_operator") throw new Error("Customer envelope required");
  const items = envelope.attachments ?? [];
  // A unique message ID is the ownership claim: concurrent messages cannot reuse the same upload.
  if (items.length)
    await env.DB.batch(
      items.map((item) =>
        env.DB.prepare(
          "UPDATE attachment SET message_id=? WHERE id=? AND (message_id IS NULL OR message_id=?)",
        ).bind(envelope.messageId, item.id, envelope.messageId),
      ),
    );
  if (items.length) {
    const claimed = await env.DB.prepare("SELECT id FROM attachment WHERE message_id=?")
      .bind(envelope.messageId)
      .all<{ id: string }>();
    if (items.some((item) => !claimed.results.some((row) => row.id === item.id)))
      fail(409, "An attachment was claimed by another message.");
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO customer_attachment_ingress (message_id,envelope) VALUES (?,?)",
  )
    .bind(envelope.messageId, JSON.stringify(envelope))
    .run();
  const stored = await env.DB.prepare(
    "SELECT envelope FROM customer_attachment_ingress WHERE message_id=?",
  )
    .bind(envelope.messageId)
    .first<{ envelope: string }>();
  const canonical = JSON.parse(stored!.envelope) as MessageWorkflowEnvelope;
  if (
    canonical.direction !== "customer_to_operator" ||
    canonical.originalText !== envelope.originalText ||
    JSON.stringify(canonical.attachments ?? []) !== JSON.stringify(items)
  )
    fail(409, "The message ID already belongs to another immutable payload.");
  return canonical;
}
