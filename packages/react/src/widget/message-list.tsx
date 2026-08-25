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

  if (transcriptState === "loading" && messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4" aria-label="Loading messages">
        <Skeleton className="h-14 w-3/4 self-end" />
        <Skeleton className="h-20 w-4/5" />
        <Skeleton className="h-12 w-2/3 self-end" />
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <ScrollArea className="h-full" viewportRef={viewportRef} onScrollCapture={handleScroll}>
        <div
          className="flex min-h-full flex-col justify-end gap-3 px-4 py-5"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
        >
          {messages.length === 0 ? (
            <div className="my-auto flex flex-col gap-1 py-16 text-center">
              <p className="text-sm font-medium text-foreground">How can we help?</p>
              <p className="text-sm text-muted-foreground">
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
            const failed = message.localDelivery === "failed_retryable";
            const status = customer ? deliveryLabel(message) : undefined;

            return (
              <div className="contents" key={message.key}>
                {showDate ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    {formatter(dateFormatters, displayLocale, {
                      dateStyle: "medium",
                    }).format(date)}
                  </p>
                ) : null}
                <article
                  className={cn(
                    "flex max-w-[84%] flex-col gap-1",
                    customer ? "self-end items-end" : "self-start items-start",
                  )}
                >
                  <p
                    className={cn(
                      "m-0 whitespace-pre-wrap break-words rounded-xl px-3 py-2.5 text-sm leading-relaxed",
                      customer
                        ? "rounded-br-sm bg-primary/10 text-foreground"
                        : "rounded-bl-sm bg-muted text-foreground",
                      failed && "bg-destructive/10 text-destructive",
                    )}
                  >
                    {message.text}
                  </p>
                  <div className="flex min-h-5 items-center gap-2 px-1 text-xs text-muted-foreground">
                    <time dateTime={message.acceptedAt}>
                      {formatter(timeFormatters, displayLocale, {
                        hour: "numeric",
                        minute: "2-digit",
                      }).format(date)}
                    </time>
                    {status === undefined ? null : <span>{status}</span>}
                    {failed && message.clientMessageId !== undefined ? (
                      <Button
                        variant="link"
                        size="xs"
                        className="h-auto px-0 text-destructive"
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
          className="absolute right-4 bottom-3 rounded-full bg-background shadow-sm"
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
