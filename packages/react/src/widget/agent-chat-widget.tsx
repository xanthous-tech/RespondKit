import { AlertCircleIcon, MessageCircleIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Alert, AlertDescription } from "#components/ui/alert";
import { Button } from "#components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#components/ui/tooltip";

import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";
import type { AgentChatContext } from "./types";
import { useAgentChat } from "./use-agent-chat";

export type { AgentChatContext } from "./types";

export interface AgentChatWidgetProps {
  readonly apiBaseUrl: string;
  readonly context: AgentChatContext;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly title?: string | undefined;
  readonly initiallyOpen?: boolean | undefined;
}

export function AgentChatWidget({
  apiBaseUrl,
  context,
  fetch,
  title = "Support",
  initiallyOpen = false,
}: AgentChatWidgetProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const titleId = useId();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const {
    bootstrapError,
    bootstrapState,
    messages,
    pollError,
    retryMessage,
    sendMessage,
    transcriptState,
  } = useAgentChat({ apiBaseUrl, context, fetch, open });

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        requestAnimationFrame(() => launcherRef.current?.focus());
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
    requestAnimationFrame(() => launcherRef.current?.focus());
  }

  return (
    <TooltipProvider>
      <div className="agent-chat-root fixed right-4 bottom-4 z-[2147483000]">
        {open ? (
          <section
            className="fixed right-4 bottom-20 flex h-[min(590px,calc(100dvh-6rem))] w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl max-sm:inset-0 max-sm:h-[100dvh] max-sm:w-screen max-sm:rounded-none max-sm:border-0"
            role="dialog"
            aria-labelledby={titleId}
          >
            <header className="flex min-h-16 items-center gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="m-0 truncate text-base font-semibold">
                  {title}
                </h2>
                <p className="m-0 text-sm text-muted-foreground">Ask us anything</p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    ref={closeRef}
                    variant="ghost"
                    size="icon-lg"
                    onClick={close}
                    aria-label="Close support chat"
                  >
                    <XIcon />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </header>

            <p className="m-0 border-b border-border px-4 py-3 text-sm text-muted-foreground">
              Messages are translated for our support team.
            </p>

            {bootstrapState === "recoverable_error" ? (
              <div className="p-4">
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>
                    {bootstrapError ?? "Support chat could not be started."}
                  </AlertDescription>
                </Alert>
              </div>
            ) : (
              <>
                {pollError === undefined ? null : (
                  <Alert className="rounded-none border-x-0 border-t-0">
                    <AlertCircleIcon />
                    <AlertDescription>
                      Reconnecting. Your existing messages are still available.
                    </AlertDescription>
                  </Alert>
                )}
                <MessageList
                  locale={context.locale}
                  messages={messages}
                  onRetry={retryMessage}
                  transcriptState={transcriptState}
                />
                <MessageComposer disabled={bootstrapState !== "ready"} onSend={sendMessage} />
              </>
            )}
          </section>
        ) : null}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              ref={launcherRef}
              className={`size-14 rounded-full shadow-lg ${open ? "max-sm:hidden" : ""}`}
              size="icon-lg"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-label="Open support chat"
            >
              <MessageCircleIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Open support chat</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
