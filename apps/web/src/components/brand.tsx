import { MessageCircleMoreIcon } from "lucide-react";

export function Brand() {
  return (
    <span className="flex items-center gap-2.5 font-semibold tracking-tight">
      <span className="flex size-7 items-center justify-center rounded-lg border bg-background">
        <MessageCircleMoreIcon aria-hidden="true" className="size-4" />
      </span>
      RespondKit
    </span>
  );
}
