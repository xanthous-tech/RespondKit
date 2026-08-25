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
      <div className="agent-chat-root ac:fixed ac:right-4 ac:bottom-4 ac:z-[2147483000]">
        {open ? (
          <section
            className="ac:fixed ac:right-4 ac:bottom-20 ac:flex ac:h-[min(590px,calc(100dvh-6rem))] ac:w-[min(390px,calc(100vw-2rem))] ac:flex-col ac:overflow-hidden ac:rounded-xl ac:border ac:border-border ac:bg-background ac:shadow-xl ac:max-sm:inset-0 ac:max-sm:h-[100dvh] ac:max-sm:w-screen ac:max-sm:rounded-none ac:max-sm:border-0"
            role="dialog"
            aria-labelledby={titleId}
          >
            <header className="ac:flex ac:min-h-16 ac:items-center ac:gap-3 ac:border-b ac:border-border ac:px-4 ac:py-3">
              <div className="ac:min-w-0 ac:flex-1">
                <h2 id={titleId} className="ac:m-0 ac:truncate ac:text-base ac:font-semibold">
                  {title}
                </h2>
                <p className="ac:m-0 ac:text-sm ac:text-muted-foreground">Ask us anything</p>
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

            <p className="ac:m-0 ac:border-b ac:border-border ac:px-4 ac:py-3 ac:text-sm ac:text-muted-foreground">
              Messages are translated for our support team.
            </p>

            {bootstrapState === "recoverable_error" ? (
              <div className="ac:p-4">
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
                  <Alert className="ac:rounded-none ac:border-x-0 ac:border-t-0">
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
              className={`ac:size-14 ac:rounded-full ac:shadow-lg ${open ? "ac:max-sm:hidden" : ""}`}
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
