import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "#lib/utils";

const alertVariants = cva(
  "ac:group/alert ac:relative ac:grid ac:w-full ac:gap-0.5 ac:rounded-lg ac:border ac:px-2.5 ac:py-2 ac:text-left ac:text-sm ac:has-data-[slot=alert-action]:relative ac:has-data-[slot=alert-action]:pr-18 ac:has-[>svg]:grid-cols-[auto_1fr] ac:has-[>svg]:gap-x-2 ac:*:[svg]:row-span-2 ac:*:[svg]:translate-y-0.5 ac:*:[svg]:text-current ac:*:[svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "ac:bg-card ac:text-card-foreground",
        destructive:
          "ac:bg-card ac:text-destructive ac:*:data-[slot=alert-description]:text-destructive/90 ac:*:[svg]:text-current",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "ac:font-medium ac:group-has-[>svg]/alert:col-start-2 ac:[&_a]:underline ac:[&_a]:underline-offset-3 ac:[&_a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "ac:text-sm ac:text-balance ac:text-muted-foreground ac:md:text-pretty ac:[&_a]:underline ac:[&_a]:underline-offset-3 ac:[&_a]:hover:text-foreground ac:[&_p:not(:last-child)]:mb-4",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("ac:absolute ac:top-2 ac:right-2", className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
