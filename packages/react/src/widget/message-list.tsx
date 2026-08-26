import { AlertCircleIcon, ArrowDownIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "#components/ui/button";
import { ScrollArea } from "#components/ui/scroll-area";
import { Skeleton } from "#components/ui/skeleton";
import { cn } from "#lib/utils";

import type { DisplayMessage, TranscriptState } from "./types";

interface MessageListProps {
  readonly locale?: string | undefined;
  readonly messages: readonly DisplayMessage[];
  readonly onRetry: (clientMessageId: string) => void;
  readonly transcriptState: TranscriptState;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  const existing = cache.get(locale);
  if (existing !== undefined) return existing;
  const created = new Intl.DateTimeFormat(locale, options);
  cache.set(locale, created);
  return created;
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function deliveryLabel(message: DisplayMessage) {
  if (message.localDelivery === "acceptance_unknown") return "Confirming…";
  if (message.localDelivery === "optimistic") return "Sending…";
  if (message.state === "failed") return "Failed";
  if (message.localDelivery === "accepted" || message.state === "processing") {
    return "Sending…";
  }
  if (message.state === "available") return "Sent";
  return undefined;
}

function scrollToBottom(viewport: HTMLDivElement) {
  if (typeof viewport.scrollTo === "function") {
    viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    return;
  }
  viewport.scrollTop = viewport.scrollHeight;
}

export function MessageList({
  locale = "en",
  messages,
  onRetry,
  transcriptState,
}: MessageListProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const previousCountRef = useRef(0);
  const [unseenCount, setUnseenCount] = useState(0);

  const displayLocale = useMemo(() => {
    try {
      return Intl.getCanonicalLocales(locale)[0] ?? "en";
    } catch {
      return "en";
    }
  }, [locale]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;

    const added = Math.max(0, messages.length - previousCountRef.current);
    previousCountRef.current = messages.length;
    if (nearBottomRef.current) {
      scrollToBottom(viewport);
      setUnseenCount(0);
    } else if (added > 0) {
      setUnseenCount((current) => current + added);
    }
  }, [messages]);

  function handleScroll() {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    nearBottomRef.current = distance < 72;
    if (nearBottomRef.current) setUnseenCount(0);
  }

  function scrollToLatest() {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    nearBottomRef.current = true;
    setUnseenCount(0);
    scrollToBottom(viewport);
  }

  if ((transcriptState === "idle" || transcriptState === "loading") && messages.length === 0) {
    return (
      <div className="ac:flex ac:flex-1 ac:flex-col ac:gap-4 ac:p-4" aria-label="Loading messages">
        <Skeleton className="ac:h-14 ac:w-3/4 ac:self-end" />
        <Skeleton className="ac:h-20 ac:w-4/5" />
        <Skeleton className="ac:h-12 ac:w-2/3 ac:self-end" />
      </div>
    );
  }

  return (
    <div className="ac:relative ac:min-h-0 ac:flex-1">
      <ScrollArea className="ac:h-full" viewportRef={viewportRef} onScrollCapture={handleScroll}>
        <div
          className="ac:flex ac:min-h-full ac:flex-col ac:justify-end ac:gap-3 ac:px-4 ac:py-5"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {messages.length === 0 ? (
            <div className="ac:my-auto ac:flex ac:flex-col ac:gap-1 ac:py-16 ac:text-center">
              <p className="ac:text-sm ac:font-medium ac:text-foreground">How can we help?</p>
              <p className="ac:text-sm ac:text-muted-foreground">
                Send a message and keep this page open for a quick reply.
              </p>
            </div>
          ) : null}

          {messages.map((message, index) => {
            const date = new Date(message.acceptedAt);
            const previous = messages[index - 1];
            const showDate =
              previous === undefined || dayKey(new Date(previous.acceptedAt)) !== dayKey(date);
            const customer = message.direction === "customer_to_operator";
            const failed =
              message.localDelivery === "failed_retryable" || message.state === "failed";
            const retryable = failed || message.localDelivery === "acceptance_unknown";
            const status = customer ? deliveryLabel(message) : undefined;

            return (
              <div className="ac:contents" key={message.key}>
                {showDate ? (
                  <p className="ac:py-2 ac:text-center ac:text-xs ac:text-muted-foreground">
                    {formatter(dateFormatters, displayLocale, {
                      dateStyle: "medium",
                    }).format(date)}
                  </p>
                ) : null}
                <article
                  className={cn(
                    "ac:flex ac:max-w-[84%] ac:flex-col ac:gap-1",
                    customer ? "ac:self-end ac:items-end" : "ac:self-start ac:items-start",
                  )}
                >
                  <p
                    className={cn(
                      "ac:m-0 ac:whitespace-pre-wrap ac:break-words ac:rounded-xl ac:px-3 ac:py-2.5 ac:text-sm ac:leading-relaxed",
                      customer
                        ? "ac:rounded-br-[4px] ac:bg-primary/10 ac:text-foreground"
                        : "ac:rounded-bl-[4px] ac:bg-muted ac:text-foreground",
                      failed && "ac:bg-destructive/10 ac:text-destructive",
                    )}
                  >
                    {message.text}
                  </p>
                  <div className="ac:flex ac:min-h-5 ac:items-center ac:gap-2 ac:px-1 ac:text-xs ac:text-muted-foreground">
                    <time dateTime={message.acceptedAt}>
                      {formatter(timeFormatters, displayLocale, {
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(date)}
                    </time>
                    {status === undefined ? null : <span>{status}</span>}
                    {retryable && message.clientMessageId !== undefined ? (
                      <Button
                        variant="link"
                        size="xs"
                        className={cn(
                          "ac:h-auto ac:px-0",
                          failed ? "ac:text-destructive" : "ac:text-primary",
                        )}
                        onClick={() => onRetry(message.clientMessageId!)}
                      >
                        <AlertCircleIcon data-icon="inline-start" />
                        Try again
                      </Button>
                    ) : null}
                  </div>
                </article>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {unseenCount > 0 ? (
        <Button
          variant="outline"
          size="sm"
          className="ac:absolute ac:right-4 ac:bottom-3 ac:rounded-full ac:bg-background ac:shadow-sm"
          onClick={scrollToLatest}
          aria-label={`Show ${unseenCount} new ${unseenCount === 1 ? "message" : "messages"}`}
        >
          <ArrowDownIcon data-icon="inline-start" />
          {unseenCount} new
        </Button>
      ) : null}
    </div>
  );
}
