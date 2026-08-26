import * as React from "react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";

import { cn } from "#lib/utils";

function ScrollArea({
  className,
  children,
  viewportRef,
  onScrollCapture,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  viewportRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("ac:relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        onScrollCapture={onScrollCapture}
        data-slot="scroll-area-viewport"
        className="ac:size-full ac:rounded-[inherit] ac:transition-[color,box-shadow] ac:outline-none ac:focus-visible:ring-[3px] ac:focus-visible:ring-ring/50 ac:focus-visible:outline-1"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "ac:flex ac:touch-none ac:p-px ac:transition-colors ac:select-none ac:data-horizontal:h-2.5 ac:data-horizontal:flex-col ac:data-horizontal:border-t ac:data-horizontal:border-t-transparent ac:data-vertical:h-full ac:data-vertical:w-2.5 ac:data-vertical:border-l ac:data-vertical:border-l-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="ac:relative ac:flex-1 ac:rounded-full ac:bg-border"
      />
    </ScrollAreaPrimitive.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
