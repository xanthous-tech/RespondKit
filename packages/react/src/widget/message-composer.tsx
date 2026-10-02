import type { AttachmentV1 } from "@respondkit/api-client";
import { SendIcon, PaperclipIcon } from "lucide-react";
import { useRef, useState, useEffect, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "#components/ui/button";
import { Textarea } from "#components/ui/textarea";

interface MessageComposerProps {
  readonly disabled: boolean;
  readonly scope?: string;
  readonly onSend: (text: string, attachments: AttachmentV1[]) => void;
  readonly onUpload: (
    file: File,
    id: string,
    signal: AbortSignal,
    progress: (sent: number, total: number) => void,
  ) => Promise<AttachmentV1>;
}

interface Picked {
  id: string;
  file: File;
  progress: number;
  attachment?: AttachmentV1;
  error?: string | undefined;
}
export function MessageComposer({ disabled, onSend, onUpload, scope }: MessageComposerProps) {
  const [files, setFiles] = useState<Picked[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Map<string, AbortController>());
  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
    },
    [],
  );
  function update(id: string, patch: Partial<Picked>) {
    setFiles((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }
  async function upload(item: Picked) {
    const controller = new AbortController();
    controllers.current.set(item.id, controller);
    update(item.id, { error: undefined, progress: 0 });
    try {
      const attachment = await onUpload(item.file, item.id, controller.signal, (sent, total) =>
        update(item.id, { progress: total ? Math.round((sent / total) * 100) : 100 }),
      );
      update(item.id, { attachment });
    } catch (error) {
      if (!controller.signal.aborted)
        update(item.id, { error: error instanceof Error ? error.message : "Upload failed" });
    } finally {
      controllers.current.delete(item.id);
    }
  }
  function remove(id: string) {
    controllers.current.get(id)?.abort();
    setFiles((items) => items.filter((item) => item.id !== id));
  }

  const [draft, setDraft] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    for (const controller of controllers.current.values()) controller.abort();
    setFiles([]);
    setDraft("");
  }, [scope]);
  const canSend =
    !disabled &&
    (draft.trim().length > 0 || files.length > 0) &&
    files.every((item) => item.attachment);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    onSend(
      draft,
      files.flatMap((item) => (item.attachment ? [item.attachment] : [])),
    );
    setFiles([]);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    formRef.current?.requestSubmit();
  }

  return (
    <form
      ref={formRef}
      className="respondkit-safe-bottom ac:flex ac:flex-wrap ac:items-end ac:gap-2 ac:border-t ac:border-border ac:bg-background ac:p-3"
      onSubmit={submit}
    >
      {files.length ? (
        <ul className="ac:m-0 ac:w-full ac:max-h-32 ac:overflow-y-auto ac:list-none ac:p-0 ac:text-xs">
          {files.map((item) => (
            <li key={item.id} className="ac:flex ac:items-center ac:gap-2 ac:py-1">
              <span className="ac:min-w-0 ac:flex-1 ac:truncate">
                {item.file.name} · {item.error ?? (item.attachment ? "Ready" : `${item.progress}%`)}
              </span>
              {item.error ? (
                <button type="button" onClick={() => void upload(item)}>
                  Retry
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => remove(item.id)}
                aria-label={`Remove ${item.file.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const incoming = Array.from(event.target.files ?? []).map((file) => ({
            id: crypto.randomUUID(),
            file,
            progress: 0,
          }));
          setFiles((items) => [...items, ...incoming]);
          incoming.forEach((item) => void upload(item));
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        disabled={disabled}
        onClick={() => fileInput.current?.click()}
        aria-label="Attach files"
      >
        <PaperclipIcon />
      </Button>
      <Textarea
        aria-label="Message"
        className="ac:min-w-0 ac:flex-1 ac:max-h-36 ac:min-h-11 ac:resize-none ac:py-2.5 ac:leading-5"
        disabled={disabled}
        maxLength={6_000}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Write a message…"
        rows={1}
        value={draft}
      />
      <Button
        type="submit"
        size="icon-lg"
        className="ac:size-11"
        disabled={!canSend}
        aria-label="Send message"
      >
        <SendIcon />
      </Button>
    </form>
  );
}
