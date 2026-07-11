import type { RefObject } from "react";
import { useEffect, useState } from "react";
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
	const [revealedActionId, setRevealedActionId] = useState<string | null>(null);
	const revealEditableAction = (item: ChatTimelineItemView) => {
		if (item.editable && !item.editing) {
			setRevealedActionId(item.id);
		}
	};

	useEffect(() => {
		function hideRevealedAction(event: PointerEvent | TouchEvent) {
			const target = event.target;
			if (
				target instanceof Element &&
				target.closest("[data-chat-editable-row='true']")
			) {
				return;
			}

			setRevealedActionId(null);
		}

		document.addEventListener("pointerdown", hideRevealedAction, true);
		document.addEventListener("touchstart", hideRevealedAction, true);
		return () => {
			document.removeEventListener("pointerdown", hideRevealedAction, true);
			document.removeEventListener("touchstart", hideRevealedAction, true);
		};
	}, []);

	return (
		<ScrollArea
			className="relative z-0 border-b border-line-soft"
			ref={props.scrollRef}
		>
			{props.items.map((item) => (
				<article
					className={`${item.itemClassName} group`}
					data-chat-editable-row={item.editable ? "true" : undefined}
					key={item.id}
					onClick={() => revealEditableAction(item)}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							revealEditableAction(item);
						}
					}}
					onPointerDown={() => revealEditableAction(item)}
				>
					<div className={item.speakerClassName}>{item.speaker}</div>
					{item.editable || item.editing ? (
						<div className="flex w-full items-start justify-end gap-2">
							<Button
								className={`relative z-10 h-7 px-2 text-xs transition-opacity ${
									item.editing
										? "opacity-100"
										: `opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 ${
												revealedActionId === item.id ? "opacity-100" : ""
											}`
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
