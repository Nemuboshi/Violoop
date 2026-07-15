// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	Button,
	Checkbox,
	Input,
	Meter,
	ResultPopover,
	ScrollArea,
	SelectField,
	SwitchField,
	TextAreaField,
	TextField,
} from "../../../src/web/shared/ui";
import {
	ChatComposer,
	ChatTimeline,
} from "../../../src/web/widgets/chat-panel";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("web components", () => {
	it("renders reusable controls and forwards user changes", async () => {
		const user = userEvent.setup();
		const onInput = vi.fn();
		const onText = vi.fn();
		const onArea = vi.fn();
		const onCheck = vi.fn();
		const onSwitch = vi.fn();
		const onSelect = vi.fn();
		const onTrigger = vi.fn();
		const onPopoverOpen = vi.fn();

		render(
			<div>
				<Button variant="primary">Primary action</Button>
				<Input aria-label="Raw input" value="raw" onChange={onInput} />
				<TextField label="Display name" value="Ava" onChange={onText} />
				<TextAreaField
					label="Role"
					value="Guide"
					onChange={onArea}
					onKeyDown={vi.fn()}
				/>
				<Checkbox label="Allow tactic" checked={false} onChange={onCheck} />
				<SwitchField label="Use cache" checked={true} onChange={onSwitch} />
				<Meter label="urgency" value={130} />
				<SelectField
					label="Reasoning"
					value="off"
					options={[
						{ label: "Off", value: "off" },
						{ label: "High", value: "high" },
					]}
					onChange={onSelect}
				/>
				<ScrollArea>
					<span>Scrollable content</span>
				</ScrollArea>
				<ResultPopover
					open={true}
					result={{
						status: "error",
						title: "Provider failed",
						detail: "Bad key",
					}}
					triggerLabel="Test"
					onOpenChange={onPopoverOpen}
					onTrigger={onTrigger}
				/>
				<ResultPopover
					open={false}
					result={null}
					triggerLabel="No result"
					onOpenChange={onPopoverOpen}
					onTrigger={onTrigger}
				/>
			</div>,
		);

		expect(
			screen.getByRole("button", { name: "Primary action" }),
		).toBeEnabled();
		await user.type(screen.getByLabelText("Raw input"), "!");
		await user.type(screen.getByLabelText("Display name"), "!");
		await user.type(screen.getByLabelText("Role"), "!");
		await user.click(screen.getByRole("checkbox", { name: "Allow tactic" }));
		await user.click(screen.getByRole("switch", { name: "Use cache" }));
		await user.click(screen.getByRole("combobox", { name: "Reasoning" }));
		await user.click(await screen.findByRole("option", { name: "High" }));
		await user.click(screen.getByRole("button", { name: "Test" }));
		await user.click(screen.getByRole("button", { name: "No result" }));

		expect(onInput).toHaveBeenCalled();
		expect(onText).toHaveBeenCalled();
		expect(onArea).toHaveBeenCalled();
		expect(onCheck).toHaveBeenCalledWith(true);
		expect(onSwitch).toHaveBeenCalledWith(false);
		expect(onSelect).toHaveBeenCalledWith("high");
		expect(onTrigger).toHaveBeenCalledTimes(2);
		expect(screen.getByText("Bad key")).toBeInTheDocument();
		expect(screen.getByText("urgency")).toBeInTheDocument();
		expect(screen.getByText("Scrollable content")).toBeInTheDocument();
	});

	it("renders chat timeline special messages and composer states", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		const onDraftChange = vi.fn();
		const onKeyDown = vi.fn();
		const onEditStart = vi.fn();
		const onEditChange = vi.fn();
		const onEditDone = vi.fn();

		render(
			<div>
				<ChatTimeline
					status="thinking"
					scrollRef={{ current: null }}
					onEditStart={onEditStart}
					onEditChange={onEditChange}
					onEditDone={onEditDone}
					items={[
						{
							id: "scene",
							itemClassName: "scene-item",
							speakerClassName: "scene-speaker",
							speaker: "Scene",
							contentClassName: "scene-content",
							content: "A quiet room.",
						},
						{
							id: "empty-assistant",
							itemClassName: "assistant-item",
							speakerClassName: "assistant-speaker",
							speaker: "Violoop",
							contentClassName: "assistant-content",
							content: "",
						},
						{
							id: "user-last",
							itemClassName: "user-item",
							speakerClassName: "user-speaker",
							speaker: "You",
							contentClassName: "user-content",
							content: "",
							editable: true,
						},
					]}
				/>
				<ChatTimeline
					status="idle"
					scrollRef={{ current: null }}
					items={[
						{
							id: "empty-idle",
							itemClassName: "idle-item",
							speakerClassName: "idle-speaker",
							speaker: "Violoop",
							contentClassName: "idle-content",
							content: "",
							editable: true,
						},
						{
							id: "empty-normal",
							itemClassName: "idle-item",
							speakerClassName: "idle-speaker",
							speaker: "Violoop",
							contentClassName: "idle-content",
							content: "",
						},
					]}
				/>
				<ChatComposer
					activeConversationId="c1"
					assistantName="Ava"
					canSend={true}
					draft="Hello"
					status="idle"
					onDraftChange={onDraftChange}
					onKeyDown={onKeyDown}
					onSubmit={onSubmit}
				/>
				<ChatComposer
					activeConversationId={null}
					assistantName="Ava"
					canSend={false}
					draft=""
					status="thinking"
					onDraftChange={vi.fn()}
					onKeyDown={vi.fn()}
					onSubmit={vi.fn()}
				/>
			</div>,
		);

		expect(screen.getByText("A quiet room.")).toBeInTheDocument();
		expect(screen.getAllByText("Thinking...")).toHaveLength(2);
		await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
		expect(onEditStart).toHaveBeenCalledWith(
			expect.objectContaining({ id: "user-last" }),
		);
		render(
			<ChatTimeline
				status="idle"
				scrollRef={{ current: null }}
				onEditChange={onEditChange}
				onEditDone={onEditDone}
				items={[
					{
						id: "user-last",
						itemClassName: "user-item",
						speakerClassName: "user-speaker",
						speaker: "You",
						contentClassName: "user-content",
						content: "Original message",
						editable: true,
						editing: true,
					},
				]}
			/>,
		);
		const editBoxes = screen.getAllByRole("textbox");
		await user.type(editBoxes.at(-1) as HTMLElement, "!");
		await user.click(screen.getByRole("button", { name: "Done" }));
		expect(onEditChange).toHaveBeenCalled();
		expect(onEditDone).toHaveBeenCalled();
		expect(
			screen.getByPlaceholderText("Ask Ava anything..."),
		).toBeInTheDocument();
		expect(
			screen.getByPlaceholderText("Start a new chat first..."),
		).toBeInTheDocument();
		await user.type(screen.getByPlaceholderText("Ask Ava anything..."), "!");
		await user.click(screen.getByRole("button", { name: "Send" }));
		expect(onDraftChange).toHaveBeenCalled();
		expect(onSubmit).toHaveBeenCalled();
	});
});
