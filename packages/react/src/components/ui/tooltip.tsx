"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "#lib/utils";

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "ac:z-50 ac:inline-flex ac:w-fit ac:max-w-xs ac:origin-(--radix-tooltip-content-transform-origin) ac:items-center ac:gap-1.5 ac:rounded-md ac:bg-foreground ac:px-3 ac:py-1.5 ac:text-xs ac:text-background ac:has-data-[slot=kbd]:pr-1.5 ac:**:data-[slot=kbd]:relative ac:**:data-[slot=kbd]:isolate ac:**:data-[slot=kbd]:z-50 ac:**:data-[slot=kbd]:rounded-sm",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="ac:z-50 ac:size-2.5 ac:translate-y-[calc(-50%_-_2px)] ac:rotate-45 ac:rounded-[2px] ac:bg-foreground ac:fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
