import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { MessageComposer } from "./message-composer";
const attachment = {
  id: `att_${"a".repeat(64)}`,
  name: "script.html",
  size: 4,
  contentType: "text/html",
  downloadUrl: "https://api.example.com/v1/files/token",
};
it("accepts arbitrary files, retries uploads with the same ID, and sends only ready attachments", async () => {
  const onSend = vi.fn();
  const onUpload = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue(attachment);
  const view = render(<MessageComposer disabled={false} onSend={onSend} onUpload={onUpload} />);
  const input = view.container.querySelector('input[type="file"]')!;
  expect(input.getAttribute("accept")).toBeNull();
  fireEvent.change(input, {
    target: { files: [new File(["test"], "script.html", { type: "text/html" })] },
  });
  await screen.findByText(/Offline/);
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled());
  expect(onUpload.mock.calls[0]?.[1]).toBe(onUpload.mock.calls[1]?.[1]);
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(onSend).toHaveBeenCalledWith("", [attachment]);
});
it("aborts unfinished uploads when their draft scope changes", async () => {
  const upload = vi.fn().mockImplementation(() => new Promise(() => {}));
  const view = render(
    <MessageComposer scope="alice" disabled={false} onSend={vi.fn()} onUpload={upload} />,
  );
  fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["a"], "a.zip")] },
  });
  view.rerender(
    <MessageComposer scope="bob" disabled={false} onSend={vi.fn()} onUpload={upload} />,
  );
  expect(upload.mock.calls[0]?.[2].aborted).toBe(true);
  expect(screen.queryByText(/a.zip/)).toBeNull();
});
