import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "#lib/utils";

const buttonVariants = cva(
  "ac:group/button ac:inline-flex ac:shrink-0 ac:items-center ac:justify-center ac:rounded-lg ac:border ac:border-transparent ac:bg-clip-padding ac:text-sm ac:font-medium ac:whitespace-nowrap ac:transition-all ac:outline-none ac:select-none ac:focus-visible:border-ring ac:focus-visible:ring-3 ac:focus-visible:ring-ring/50 ac:active:not-aria-[haspopup]:translate-y-px ac:disabled:pointer-events-none ac:disabled:opacity-50 ac:aria-invalid:border-destructive ac:aria-invalid:ring-3 ac:aria-invalid:ring-destructive/20 ac:dark:aria-invalid:border-destructive/50 ac:dark:aria-invalid:ring-destructive/40 ac:[&_svg]:pointer-events-none ac:[&_svg]:shrink-0 ac:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "ac:bg-primary ac:text-primary-foreground ac:hover:bg-primary/80",
        outline:
          "ac:border-border ac:bg-background ac:hover:bg-muted ac:hover:text-foreground ac:aria-expanded:bg-muted ac:aria-expanded:text-foreground ac:dark:border-input ac:dark:bg-input/30 ac:dark:hover:bg-input/50",
        secondary:
          "ac:bg-secondary ac:text-secondary-foreground ac:hover:bg-[color-mix(in_oklch,var(--respondkit-secondary),var(--respondkit-foreground)_5%)] ac:aria-expanded:bg-secondary ac:aria-expanded:text-secondary-foreground",
        ghost:
          "ac:hover:bg-muted ac:hover:text-foreground ac:aria-expanded:bg-muted ac:aria-expanded:text-foreground ac:dark:hover:bg-muted/50",
        destructive:
          "ac:bg-destructive/10 ac:text-destructive ac:hover:bg-destructive/20 ac:focus-visible:border-destructive/40 ac:focus-visible:ring-destructive/20 ac:dark:bg-destructive/20 ac:dark:hover:bg-destructive/30 ac:dark:focus-visible:ring-destructive/40",
        link: "ac:text-primary ac:underline-offset-4 ac:hover:underline",
      },
      size: {
        default:
          "ac:h-8 ac:gap-1.5 ac:px-2.5 ac:has-data-[icon=inline-end]:pr-2 ac:has-data-[icon=inline-start]:pl-2",
        xs: "ac:h-6 ac:gap-1 ac:rounded-[min(var(--ac-radius-md),10px)] ac:px-2 ac:text-xs ac:in-data-[slot=button-group]:rounded-lg ac:has-data-[icon=inline-end]:pr-1.5 ac:has-data-[icon=inline-start]:pl-1.5 ac:[&_svg:not([class*=size-])]:size-3",
        sm: "ac:h-7 ac:gap-1 ac:rounded-[min(var(--ac-radius-md),12px)] ac:px-2.5 ac:text-[0.8rem] ac:in-data-[slot=button-group]:rounded-lg ac:has-data-[icon=inline-end]:pr-1.5 ac:has-data-[icon=inline-start]:pl-1.5 ac:[&_svg:not([class*=size-])]:size-3.5",
        lg: "ac:h-9 ac:gap-1.5 ac:px-2.5 ac:has-data-[icon=inline-end]:pr-2 ac:has-data-[icon=inline-start]:pl-2",
        icon: "ac:size-8",
        "icon-xs":
          "ac:size-6 ac:rounded-[min(var(--ac-radius-md),10px)] ac:in-data-[slot=button-group]:rounded-lg ac:[&_svg:not([class*=size-])]:size-3",
        "icon-sm":
          "ac:size-7 ac:rounded-[min(var(--ac-radius-md),12px)] ac:in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "ac:size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
