import { SendIcon } from "lucide-react";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "#components/ui/button";
import { Textarea } from "#components/ui/textarea";

interface MessageComposerProps {
  readonly disabled: boolean;
  readonly onSend: (text: string) => void;
}

export function MessageComposer({ disabled, onSend }: MessageComposerProps) {
  const [draft, setDraft] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const canSend = !disabled && draft.trim().length > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    onSend(draft);
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
      className="agent-chat-safe-bottom ac:flex ac:items-end ac:gap-2 ac:border-t ac:border-border ac:bg-background ac:p-3"
      onSubmit={submit}
    >
      <Textarea
        aria-label="Message"
        className="ac:max-h-36 ac:min-h-11 ac:resize-none ac:py-2.5"
        disabled={disabled}
        maxLength={6_000}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Write a message…"
        rows={1}
        value={draft}
      />
      <Button type="submit" size="icon-lg" disabled={!canSend} aria-label="Send message">
        <SendIcon />
      </Button>
    </form>
  );
}
