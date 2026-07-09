import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { forwardRef, type ReactNode } from "react";

type ScrollAreaProps = {
	children: ReactNode;
	className?: string;
	contentClassName?: string;
	viewportClassName?: string;
};

export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(
	function ScrollArea(
		{ children, className = "", contentClassName = "", viewportClassName = "" },
		ref,
	) {
		return (
			<ScrollAreaPrimitive.Root
				className={`relative min-h-0 overflow-hidden ${className}`}
			>
				<ScrollAreaPrimitive.Viewport
					className={`h-full min-h-0 w-full overscroll-contain pr-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${viewportClassName}`}
					ref={ref}
				>
					<ScrollAreaPrimitive.Content className={contentClassName}>
						{children}
					</ScrollAreaPrimitive.Content>
				</ScrollAreaPrimitive.Viewport>
				<ScrollAreaPrimitive.Scrollbar
					className="absolute right-0 top-0 flex h-full w-2 justify-center bg-white opacity-0 transition-opacity data-[hovering]:opacity-100 data-[scrolling]:opacity-100"
					orientation="vertical"
				>
					<ScrollAreaPrimitive.Thumb className="w-1 bg-neutral-950" />
				</ScrollAreaPrimitive.Scrollbar>
			</ScrollAreaPrimitive.Root>
		);
	},
);
