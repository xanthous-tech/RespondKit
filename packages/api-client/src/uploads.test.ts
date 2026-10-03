import { expect, it, vi } from "vite-plus/test";
import { uploadAttachment } from "./uploads";
const id = `att_${"a".repeat(64)}`;
const attachment = {
  id,
  name: "file.bin",
  size: 5,
  contentType: "application/octet-stream",
  downloadUrl: "https://api.example/v1/files/secret",
};
it("slices large uploads, reports progress, and finalizes only after every part", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ id, partSize: 3 }))
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(Response.json(attachment));
  const read = vi.fn(async (_offset: number, count: number) => new Uint8Array(count));
  const progress = vi.fn();
  expect(
    await uploadAttachment(
      { baseUrl: "https://api.example", fetch: fetcher },
      { ...attachment, read },
      { clientUploadId: "u1", getToken: async () => "token", onProgress: progress },
    ),
  ).toEqual(attachment);
  expect(read.mock.calls).toEqual([
    [0, 3],
    [3, 2],
  ]);
  expect(progress.mock.calls.at(-1)).toEqual([5, 5]);
  expect(fetcher.mock.calls[2]?.[0]).toContain("/parts/2");
});
it("reuses completed uploads after a lost completion response and never rereads the file", async () => {
  const read = vi.fn();
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ id, partSize: 3, completed: attachment }));
  await uploadAttachment(
    { baseUrl: "https://api.example", fetch: fetcher },
    { ...attachment, read },
    { clientUploadId: "u1", getToken: async () => "token" },
  );
  expect(read).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("stops when a file changes or upload is cancelled", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ id, partSize: 3 }));
  await expect(
    uploadAttachment(
      { baseUrl: "https://api.example", fetch: fetcher },
      { ...attachment, read: async () => new Uint8Array(1) },
      { clientUploadId: "u1", getToken: async () => "token" },
    ),
  ).rejects.toThrow("File changed");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
