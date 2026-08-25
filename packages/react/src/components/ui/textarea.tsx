import * as React from "react";

import { cn } from "#lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "ac:flex ac:field-sizing-content ac:min-h-16 ac:w-full ac:rounded-lg ac:border ac:border-input ac:bg-transparent ac:px-2.5 ac:py-2 ac:text-base ac:transition-colors ac:outline-none ac:placeholder:text-muted-foreground ac:focus-visible:border-ring ac:focus-visible:ring-3 ac:focus-visible:ring-ring/50 ac:disabled:cursor-not-allowed ac:disabled:bg-input/50 ac:disabled:opacity-50 ac:aria-invalid:border-destructive ac:aria-invalid:ring-3 ac:aria-invalid:ring-destructive/20 ac:md:text-sm ac:dark:bg-input/30 ac:dark:disabled:bg-input/80 ac:dark:aria-invalid:border-destructive/50 ac:dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
