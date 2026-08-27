import { AlertCircleIcon, MessageCircleIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

import { Alert, AlertDescription } from "#components/ui/alert";
import { Button } from "#components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#components/ui/tooltip";

import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";
import { respondKitAccentPalette, type RespondKitAccentColor } from "./theme";
import type { RespondKitContext } from "./types";
import { useRespondKit } from "./use-respondkit";

export type { RespondKitContext } from "./types";

export interface RespondKitWidgetProps {
  readonly apiBaseUrl: string;
  readonly context: RespondKitContext;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly title?: string | undefined;
  readonly initiallyOpen?: boolean | undefined;
  readonly accentColor?: RespondKitAccentColor | undefined;
}

export function RespondKitWidget({
  apiBaseUrl,
  context,
  fetch,
  title = "Support",
  initiallyOpen = false,
  accentColor = "indigo",
}: RespondKitWidgetProps) {
  const [open, setOpen] = useState(initiallyOpen);
  const titleId = useId();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const {
    bootstrapError,
    bootstrapState,
    hasUnreadReply,
    messages,
    pollError,
    retryMessage,
    sendMessage,
    transcriptState,
  } = useRespondKit({ apiBaseUrl, context, fetch, open });

  useEffect(() => {
    if (!open) return;
    titleRef.current?.focus({ preventScroll: true });

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

  function toggle() {
    if (open) {
      close();
      return;
    }
    setOpen(true);
  }

  const accentValue = respondKitAccentPalette[accentColor];
  const themeStyle = {
    "--respondkit-primary": accentValue,
    "--respondkit-ring": accentValue,
  } as CSSProperties;

  return (
    <TooltipProvider>
      <div
        className="respondkit-root ac:fixed ac:right-4 ac:bottom-4 ac:z-[2147483000]"
        data-accent-color={accentColor}
        style={themeStyle}
      >
        {open ? (
          <section
            className="ac:fixed ac:right-4 ac:bottom-20 ac:flex ac:h-[min(590px,calc(100dvh-6rem))] ac:w-[min(390px,calc(100vw-2rem))] ac:flex-col ac:overflow-hidden ac:rounded-xl ac:border ac:border-border ac:bg-background ac:shadow-xl ac:max-sm:inset-0 ac:max-sm:h-[100dvh] ac:max-sm:w-screen ac:max-sm:rounded-none ac:max-sm:border-0"
            role="dialog"
            aria-labelledby={titleId}
          >
            <header className="ac:flex ac:min-h-16 ac:items-center ac:gap-3 ac:border-b ac:border-border ac:px-4 ac:py-3">
              <div className="ac:min-w-0 ac:flex-1">
                <h2
                  ref={titleRef}
                  id={titleId}
                  tabIndex={-1}
                  className="ac:m-0 ac:truncate ac:text-base ac:font-semibold ac:focus:outline-none"
                >
                  {title}
                </h2>
                <p className="ac:m-0 ac:text-sm ac:text-muted-foreground">Ask us anything</p>
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      onClick={close}
                      aria-label="Close support chat"
                    />
                  }
                >
                  <XIcon />
                </TooltipTrigger>
                <TooltipContent>Close</TooltipContent>
              </Tooltip>
            </header>

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
          <TooltipTrigger
            render={
              <Button
                ref={launcherRef}
                className={`ac:relative ac:size-14 ac:rounded-full ac:shadow-lg ${open ? "ac:max-sm:hidden" : ""}`}
                size="icon-lg"
                onClick={toggle}
                aria-expanded={open}
                aria-label={open ? "Close support chat" : "Open support chat"}
              />
            }
          >
            {open ? <XIcon /> : <MessageCircleIcon />}
            {!open && hasUnreadReply ? (
              <span
                className="ac:absolute ac:-top-0.5 ac:-right-0.5 ac:size-3.5 ac:rounded-full ac:border-2 ac:border-background ac:bg-red-500"
                role="status"
                aria-label="Unread support reply"
              />
            ) : null}
          </TooltipTrigger>
          <TooltipContent side="left">
            {open ? "Close support chat" : "Open support chat"}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
