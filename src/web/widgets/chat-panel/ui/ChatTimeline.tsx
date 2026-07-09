import type { RefObject } from "react";
import { Button, ScrollArea, TextAreaField } from "../../../shared/ui";
import type { ChatTimelineItemView } from "../model/types";

type ChatTimelineProps = {
	items: ChatTimelineItemView[];
	status: "idle" | "thinking" | "error";
	scrollRef: RefObject<HTMLDivElement | null>;
	onEditStart?: (item: ChatTimelineItemView) => void;
	onEditChange?: (value: string) => void;
	onEditDone?: () => void;
};

export function ChatTimeline(props: ChatTimelineProps) {
	return (
		<ScrollArea className="border-b border-line-soft" ref={props.scrollRef}>
			{props.items.map((item) => (
				<article className={`${item.itemClassName} group`} key={item.id}>
					<div className={item.speakerClassName}>{item.speaker}</div>
					{item.editable || item.editing ? (
						<div className="flex w-full items-start justify-end gap-2">
							<Button
								className={`h-7 px-2 text-xs transition-opacity ${
									item.editing
										? "opacity-100"
										: "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
								}`}
								type="button"
								onClick={() =>
									item.editing
										? props.onEditDone?.()
										: props.onEditStart?.(item)
								}
							>
								{item.editing ? "Done" : "Edit"}
							</Button>
							{item.editing ? (
								<TextAreaField
									className="max-w-[min(680px,82%)]"
									controlClassName="min-h-20 resize-y"
									rows={3}
									value={item.editValue ?? item.content}
									onChange={(value) => props.onEditChange?.(value)}
								/>
							) : (
								<p className={item.contentClassName}>
									{item.content ||
										(props.status === "thinking" ? "Thinking..." : "")}
								</p>
							)}
						</div>
					) : (
						<p className={item.contentClassName}>
							{item.content ||
								(props.status === "thinking" ? "Thinking..." : "")}
						</p>
					)}
				</article>
			))}
		</ScrollArea>
	);
}
