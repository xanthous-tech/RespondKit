import { env } from "cloudflare:test";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { AttachmentV1Schema, UploadV1Schema } from "@respondkit/protocol";
import { createHttpApp } from "./http";
import { createCustomerFixture, createTestEnv, seedTopology, TEST_ORIGIN } from "../test/fixtures";
beforeEach(() => seedTopology());
async function setup() {
  const user = await createCustomerFixture();
  const createBatch = vi.fn().mockResolvedValue([{}]);
  const runtime = createTestEnv({
    ATTACHMENTS: (env as unknown as { ATTACHMENTS: R2Bucket }).ATTACHMENTS,
    MESSAGE_WORKFLOW: { createBatch } as unknown as typeof env.MESSAGE_WORKFLOW,
  });
  const app = createHttpApp();
  const headers = {
    origin: TEST_ORIGIN,
    authorization: `Bearer ${user.sessionToken}`,
    "content-type": "application/json",
  };
  async function call(path: string, body: unknown, method = "POST", token = user.sessionToken) {
    return app.request(
      path,
      {
        method,
        headers: { ...headers, authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      },
      runtime,
    );
  }
  const input = {
    clientUploadId: "test_upload",
    name: "sample.html",
    size: 3,
    contentType: "text/html",
  };
  const upload = UploadV1Schema.parse(await (await call("/v1/attachments", input)).json());
  return { user, createBatch, runtime, app, headers, call, input, upload };
}
it("uploads all file types, persists metadata, and serves only safe downloads after send", async () => {
  const s = await setup();
  expect((await s.call(`/v1/attachments/${s.upload.id}/complete`, {})).status).toBe(409);
  const part = await s.app.request(
    `/v1/attachments/${s.upload.id}/parts/1`,
    { method: "PUT", headers: { ...s.headers, "content-length": "3" }, body: "abc" },
    s.runtime,
  );
  expect(part.status).toBe(200);
  const attachment = AttachmentV1Schema.parse(
    await (await s.call(`/v1/attachments/${s.upload.id}/complete`, {})).json(),
  );
  expect((await s.app.request(attachment.downloadUrl, {}, s.runtime)).status).toBe(404);
  const body = {
    clientMessageId: "cm_file",
    text: "Attached files",
    attachmentIds: [attachment.id],
  };
  expect((await s.call(`/v1/threads/${s.user.threadId}/messages`, body)).status).toBe(202);
  expect((await s.call(`/v1/threads/${s.user.threadId}/messages`, body)).status).toBe(202);
  expect(s.createBatch.mock.calls[0]).toEqual(s.createBatch.mock.calls[1]);
  expect(s.createBatch.mock.calls[0]?.[0][0].params.attachments).toEqual([attachment]);
  const download = await s.app.request(attachment.downloadUrl, {}, s.runtime);
  expect(download.headers.get("content-type")).toBe("application/octet-stream");
  expect(download.headers.get("content-disposition")).toContain("attachment;");
  expect(download.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await download.text()).toBe("abc");
  const restored = UploadV1Schema.parse(await (await s.call("/v1/attachments", s.input)).json());
  expect(restored.completed).toEqual(attachment);
  expect(
    (await s.call(`/v1/threads/${s.user.threadId}/messages`, { ...body, text: "Changed" })).status,
  ).toBe(409);
});
it("rejects cross-visitor uploads, unfinished files, duplicate IDs, and mutated metadata", async () => {
  const s = await setup();
  const other = await createCustomerFixture();
  expect(
    (await s.call(`/v1/attachments/${s.upload.id}/complete`, {}, "POST", other.sessionToken))
      .status,
  ).toBe(404);
  expect((await s.call("/v1/attachments", { ...s.input, name: "another.zip" })).status).toBe(409);
  expect(
    (
      await s.call(`/v1/threads/${s.user.threadId}/messages`, {
        clientMessageId: "bad",
        text: "Files",
        attachmentIds: [s.upload.id],
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await s.call(`/v1/threads/${s.user.threadId}/messages`, {
        clientMessageId: "bad",
        text: "Files",
        attachmentIds: [s.upload.id, s.upload.id],
      })
    ).status,
  ).toBe(400);
});
it("supports empty files and explicit cancellation without a retention timer", async () => {
  const s = await setup();
  const empty = UploadV1Schema.parse(
    await (
      await s.call("/v1/attachments", { ...s.input, clientUploadId: "empty", size: 0 })
    ).json(),
  );
  expect((await s.call(`/v1/attachments/${empty.id}/complete`, {})).status).toBe(200);
  expect((await s.call(`/v1/attachments/${s.upload.id}`, {}, "DELETE")).status).toBe(200);
  expect((await s.call(`/v1/attachments/${s.upload.id}/complete`, {})).status).toBe(409);
});
