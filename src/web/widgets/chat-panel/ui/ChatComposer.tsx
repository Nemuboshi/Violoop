import { Form } from "@base-ui/react/form";
import type { KeyboardEvent } from "react";
import { Button, TextAreaField } from "../../../shared/ui";

type ChatComposerProps = {
	activeConversationId: string | null;
	assistantName: string;
	canSend: boolean;
	draft: string;
	status: "idle" | "thinking" | "error";
	onDraftChange(value: string): void;
	onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void;
	onSubmit(): void;
};

export function ChatComposer(props: ChatComposerProps) {
	return (
		<Form
			className="grid grid-cols-[minmax(0,1fr)_96px] gap-3 pt-4 max-md:grid-cols-1"
			onFormSubmit={props.onSubmit}
		>
			<TextAreaField
				className="gap-0"
				controlClassName="max-h-36 min-h-14 py-2.5 text-sm leading-6"
				label=""
				value={props.draft}
				rows={2}
				placeholder={
					props.activeConversationId
						? `Ask ${props.assistantName} anything...`
						: "Start a new chat first..."
				}
				onChange={props.onDraftChange}
				onKeyDown={props.onKeyDown}
			/>
			<Button
				className="min-h-14 font-semibold"
				variant="primary"
				type="submit"
				disabled={!props.canSend}
			>
				{props.status === "thinking" ? "Waiting…" : "Send"}
			</Button>
		</Form>
	);
}
