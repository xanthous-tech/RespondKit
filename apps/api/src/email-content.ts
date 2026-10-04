import type { AttachmentV1 } from "@respondkit/protocol";
import { decodeHTML } from "entities";
import type { Hono } from "hono";
import PostalMime from "postal-mime";
import type { Env } from "./env";

export const randomToken = () => crypto.randomUUID().replaceAll("-", "");
export async function emailHash(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function publicEmailUrl(env: Env, path: string): string {
  if (!env.PUBLIC_API_URL) throw new Error("PUBLIC_API_URL is required for email files");
  const url = new URL(env.PUBLIC_API_URL);
  if (url.protocol !== "https:" && url.hostname !== "localhost")
    throw new Error("PUBLIC_API_URL must use HTTPS");
  return new URL(path, url).href;
}
export type EmailSource = {
  message_id: string;
  raw_key: string;
  html_key: string | null;
  download_token: string;
};
export async function emailSource(env: Env, messageId: string) {
  return env.DB.prepare("SELECT * FROM email_source WHERE message_id=?")
    .bind(messageId)
    .first<EmailSource>();
}
/** First stored MIME wins, including if redelivery changes the bytes under the same Message-ID. */
export async function captureEmail(env: Env, messageId: string, raw: ReadableStream) {
  if (!env.ATTACHMENTS) throw new Error("ATTACHMENTS is required for email ingress");
  let source = await emailSource(env, messageId);
  if (!source) {
    const key = `email/${messageId}/${randomToken()}.eml`;
    await env.ATTACHMENTS.put(key, raw);
    await env.DB.prepare(`INSERT OR IGNORE INTO email_source
      (message_id,raw_key,download_token,created_at) VALUES (?,?,?,?)`)
      .bind(messageId, key, randomToken() + randomToken(), Date.now())
      .run();
    source = await emailSource(env, messageId);
    if (!source) throw new Error("Email archive missing");
    if (source.raw_key !== key) await env.ATTACHMENTS.delete(key);
  }
  const object = await env.ATTACHMENTS.get(source.raw_key);
  if (!object) throw new Error("Email MIME missing from storage");
  const parsed = await PostalMime.parse(await object.arrayBuffer());
  if (parsed.html !== undefined) {
    const htmlKey = `${source.raw_key}.html`;
    await env.ATTACHMENTS.put(htmlKey, parsed.html);
    await env.DB.prepare("UPDATE email_source SET html_key=? WHERE message_id=?")
      .bind(htmlKey, messageId)
      .run();
  }
  return parsed;
}

/** Extract readable text only; the untouched HTML is kept separately, never converted to Markdown. */
export async function emailPreview(parsed: {
  text?: string | undefined;
  html?: string | undefined;
}): Promise<string> {
  let text = parsed.text?.trim();
  if (!text && parsed.html) {
    const parts: string[] = [];
    const response = new HTMLRewriter()
      .on("script,style,head,template", {
        element(element) {
          element.remove();
        },
      })
      .on("br,p,div,li,tr,h1,h2,h3", {
        element(element) {
          element.before("\n");
        },
      })
      .transform(new Response(parsed.html));
    // A second pass sees only the remaining visible text, including inserted separators.
    await new HTMLRewriter()
      .onDocument({
        text(chunk) {
          parts.push(chunk.text);
        },
      })
      .transform(response)
      .text();
    text = decodeHTML(parts.join(""))
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  const preview = text || "Email with attached content.";
  if (preview.length <= 6000) return preview;
  return `${preview.slice(0, 5900)}\n\n[Email preview truncated; the original email is preserved.]`;
}

export async function storeEmailAttachments(
  env: Env,
  scope: { messageId: string; workspaceId: string; inboxId: string; visitorId: string },
  files: Awaited<ReturnType<typeof PostalMime.parse>>["attachments"],
): Promise<AttachmentV1[]> {
  if (!env.ATTACHMENTS) throw new Error("ATTACHMENTS is required for email files");
  const result: AttachmentV1[] = [];
  for (const [index, file] of files.entries()) {
    const id = `att_${await emailHash(JSON.stringify([scope.messageId, index]))}`;
    const key = `email/${scope.messageId}/attachments/${index}`;
    const token = randomToken() + randomToken();
    const content =
      typeof file.content === "string" ? new TextEncoder().encode(file.content) : file.content;
    const name = (file.filename || `attachment-${index + 1}`)
      .replace(/[\r\n]/g, "_")
      .replaceAll(String.fromCharCode(0), "_")
      .slice(0, 255);
    await env.DB.prepare(`INSERT OR IGNORE INTO attachment
      (id,workspace_id,inbox_id,visitor_id,object_key,download_token,download_url,name,content_type,size,upload_id,part_size,message_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,'',1,?)`)
      .bind(
        id,
        scope.workspaceId,
        scope.inboxId,
        scope.visitorId,
        key,
        token,
        publicEmailUrl(env, `/v1/files/${token}`),
        name,
        file.mimeType || "application/octet-stream",
        content.byteLength,
        scope.messageId,
      )
      .run();
    const row = await env.DB.prepare(
      "SELECT status,download_url FROM attachment WHERE id=? AND message_id=?",
    )
      .bind(id, scope.messageId)
      .first<{ status: string; download_url: string }>();
    if (!row) throw new Error("Email attachment identity conflict");
    if (row.status !== "ready") {
      await env.ATTACHMENTS.put(key, content);
      await env.DB.prepare("UPDATE attachment SET status='ready' WHERE id=?").bind(id).run();
    }
    result.push({
      id,
      name,
      contentType: file.mimeType || "application/octet-stream",
      size: content.byteLength,
      downloadUrl: row.download_url,
    });
  }
  return result;
}

export async function emailArchiveLinks(env: Env, messageId: string): Promise<string> {
  const source = await emailSource(env, messageId);
  if (!source) return "";
  const base = publicEmailUrl(env, `/v1/email-files/${source.download_token}`);
  return `\nOriginal email: ${base}/original.eml${source.html_key ? `\nOriginal HTML: ${base}/original.html` : ""}`;
}
export function registerEmailFileRoutes(
  app: Hono<{ Bindings: Env; Variables: { corsOrigin?: string } }>,
) {
  app.get("/v1/email-files/:token/:filename", async (c) => {
    const token = c.req.param("token");
    const filename = c.req.param("filename");
    if (!/^[a-f0-9]{64}$/.test(token) || !["original.eml", "original.html"].includes(filename))
      return c.notFound();
    const source = await c.env.DB.prepare("SELECT * FROM email_source WHERE download_token=?")
      .bind(token)
      .first<EmailSource>();
    const key = filename === "original.eml" ? source?.raw_key : source?.html_key;
    if (!key || !c.env.ATTACHMENTS) return c.notFound();
    const object = await c.env.ATTACHMENTS.get(key);
    if (!object) return c.notFound();
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(object.size),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  });
}
export const escapeEmailHtml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export async function outgoingEmailContent(
  env: Env,
  messageId: string,
  body: string,
  includeArchive: boolean,
) {
  const row = await env.DB.prepare("SELECT attachments FROM message WHERE id=?")
    .bind(messageId)
    .first<{ attachments: string }>();
  const files = JSON.parse(row?.attachments ?? "[]") as AttachmentV1[];
  const links = files.map((file) => `\n${file.name}: ${file.downloadUrl}`).join("");
  const archive = includeArchive ? await emailArchiveLinks(env, messageId) : "";
  const source = await emailSource(env, messageId);
  const html =
    includeArchive && source?.html_key && env.ATTACHMENTS
      ? await (await env.ATTACHMENTS.get(source.html_key))?.text()
      : undefined;
  return {
    text: `${body}${links}${archive}`,
    // Reserve MIME encoding/headroom under the provider limit; larger HTML remains in R2.
    ...(html && new TextEncoder().encode(html).byteLength <= 1024 * 1024
      ? { html: `${html}<pre>${escapeEmailHtml(links + archive)}</pre>` }
      : {}),
  };
}

/** Never copy a private operator reply capability into the customer transcript. */
export function customerEmailPreview(text: string): string {
  return text.replace(/operator\+[a-f0-9]{32}@[a-z0-9.-]+/gi, "[private operator reply address]");
}
