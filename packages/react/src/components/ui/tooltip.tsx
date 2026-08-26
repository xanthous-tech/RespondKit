"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "#lib/utils";

function TooltipProvider({ delay = 0, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />;
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="ac:isolate ac:z-50"
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "agent-chat-root ac:z-50 ac:inline-flex ac:w-fit ac:max-w-xs ac:origin-(--transform-origin) ac:items-center ac:gap-1.5 ac:rounded-md ac:bg-foreground ac:px-3 ac:py-1.5 ac:text-xs ac:text-background ac:has-data-[slot=kbd]:pr-1.5 ac:data-[side=bottom]:slide-in-from-top-2 ac:data-[side=inline-end]:slide-in-from-left-2 ac:data-[side=inline-start]:slide-in-from-right-2 ac:data-[side=left]:slide-in-from-right-2 ac:data-[side=right]:slide-in-from-left-2 ac:data-[side=top]:slide-in-from-bottom-2 ac:**:data-[slot=kbd]:relative ac:**:data-[slot=kbd]:isolate ac:**:data-[slot=kbd]:z-50 ac:**:data-[slot=kbd]:rounded-sm ac:data-[state=delayed-open]:animate-in ac:data-[state=delayed-open]:fade-in-0 ac:data-[state=delayed-open]:zoom-in-95 ac:data-open:animate-in ac:data-open:fade-in-0 ac:data-open:zoom-in-95 ac:data-closed:animate-out ac:data-closed:fade-out-0 ac:data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="ac:z-50 ac:size-2.5 ac:translate-y-[calc(-50%-2px)] ac:rotate-45 ac:rounded-[2px] ac:bg-foreground ac:fill-foreground ac:data-[side=bottom]:top-1 ac:data-[side=inline-end]:top-1/2! ac:data-[side=inline-end]:-left-1 ac:data-[side=inline-end]:-translate-y-1/2 ac:data-[side=inline-start]:top-1/2! ac:data-[side=inline-start]:-right-1 ac:data-[side=inline-start]:-translate-y-1/2 ac:data-[side=left]:top-1/2! ac:data-[side=left]:-right-1 ac:data-[side=left]:-translate-y-1/2 ac:data-[side=right]:top-1/2! ac:data-[side=right]:-left-1 ac:data-[side=right]:-translate-y-1/2 ac:data-[side=top]:-bottom-2.5" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
