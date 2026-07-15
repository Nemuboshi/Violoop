// @vitest-environment jsdom

import { Dialog } from "@base-ui/react/dialog";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/web/app/App";
import {
	deleteConversation,
	getConversation,
	listConversations,
} from "../../src/web/entities/conversation";
import { fetchTacticsStatus } from "../../src/web/entities/tactic";
import { createLocalConversation } from "../../src/web/features/chat-session/api/createLocalConversation";
import { loadConfig } from "../../src/web/features/config-settings/api/configApi";
import {
	DeleteConversationModal,
	RenameConversationModal,
} from "../../src/web/features/conversation-management";
import { NewChatModal } from "../../src/web/features/new-chat";
import {
	newProviderEditorDraft,
	ProviderEditModal,
} from "../../src/web/features/provider-management";
import {
	newTacticEditorDraft,
	TacticEditModal,
} from "../../src/web/features/tactic-management";
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
} from "../../src/web/shared/ui";
import { ChatComposer, ChatTimeline } from "../../src/web/widgets/chat-panel";
import { ConfigModal } from "../../src/web/widgets/config-modal";
import { ConfigSettingsTab } from "../../src/web/widgets/config-modal/ui/ConfigSettingsTab";
import { SidebarContent } from "../../src/web/widgets/sidebar";

vi.mock("../../src/web/entities/conversation", () => ({
	deleteConversation: vi.fn(),
	getConversation: vi.fn(),
	listConversations: vi.fn(),
	renameConversation: vi.fn(),
}));

vi.mock("../../src/web/entities/tactic", () => ({
	deleteStateDefinition: vi.fn(),
	deleteTactic: vi.fn(),
	fetchTacticsStatus: vi.fn(),
	saveStateDefinition: vi.fn(),
	saveTactic: vi.fn(),
}));

vi.mock("../../src/web/features/config-settings/api/configApi", () => ({
	loadConfig: vi.fn(),
	saveConfig: vi.fn(),
}));

vi.mock(
	"../../src/web/features/chat-session/api/createLocalConversation",
	() => ({
		createLocalConversation: vi.fn(),
	}),
);

const stateDefinitions = [
	{
		id: "urgency",
		name: "Urgency",
		defaultValue: 40,
	},
	{
		id: "confidence-needed",
		name: "Confidence needed",
		defaultValue: 50,
	},
	{
		id: "stress",
		name: "Stress",
		defaultValue: 30,
	},
];

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

	it("wires settings import controls and reveals editing on a keyboard-focused timeline row", async () => {
		const onImportStrategy = vi.fn();
		const onImport = vi.fn();
		render(
			<Dialog.Root open>
				<ConfigSettingsTab
					activeModelLabel="Active model"
					draft={{
						defaultModel: "model-a",
						temperature: "0.7",
						thinkingLevel: "off",
						systemPrompt: "System",
						systemPromptCache: false,
						compactionEnabled: true,
						compactionTriggerTokens: "1000",
						compactionKeepRecentTokens: "100",
					}}
					error=""
					modelOptions={[]}
					thinkingLevelOptions={[{ label: "Off", value: "off" }]}
					saving={false}
					importStrategy="replace"
					onImportStrategy={onImportStrategy}
					onImport={onImport}
					onSubmit={vi.fn()}
					onUpdate={vi.fn()}
				/>
			</Dialog.Root>,
		);
		onImportStrategy("skip");
		const file = new File(["{}"], "violoop.json", { type: "application/json" });
		const input = document.querySelector(
			"input[type='file']",
		) as HTMLInputElement;
		await userEvent.setup().upload(input, file);
		expect(onImport).toHaveBeenCalledWith(file, "replace");
		fireEvent.change(input, { target: { files: null } });
		expect(onImport).toHaveBeenCalledTimes(1);

		const onEditStart = vi.fn();
		const { unmount } = render(
			<ChatTimeline
				status="idle"
				scrollRef={{ current: null }}
				onEditStart={onEditStart}
				items={[
					{
						id: "user-last",
						itemClassName: "user-item",
						speakerClassName: "user-speaker",
						speaker: "You",
						contentClassName: "user-content",
						content: "Hello",
						editable: true,
					},
				]}
			/>,
		);
		const row = screen.getByText("Hello").closest("article");
		fireEvent.keyDown(row as HTMLElement, { key: "Enter" });
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		expect(onEditStart).toHaveBeenCalled();
		unmount();
	});

	it("selects an import conflict strategy from the settings combobox", async () => {
		const user = userEvent.setup();
		const onImportStrategy = vi.fn();
		render(
			<Dialog.Root open>
				<ConfigSettingsTab
					activeModelLabel="Active model"
					draft={{
						defaultModel: "model-a",
						temperature: "0.7",
						thinkingLevel: "off",
						systemPrompt: "System",
						systemPromptCache: false,
						compactionEnabled: true,
						compactionTriggerTokens: "1000",
						compactionKeepRecentTokens: "100",
					}}
					error=""
					modelOptions={[]}
					thinkingLevelOptions={[{ label: "Off", value: "off" }]}
					saving={false}
					importStrategy="replace"
					onImportStrategy={onImportStrategy}
					onImport={vi.fn()}
					onSubmit={vi.fn()}
					onUpdate={vi.fn()}
				/>
			</Dialog.Root>,
		);
		await user.click(
			screen.getByRole("combobox", { name: "Import conflict behavior" }),
		);
		await user.click(
			await screen.findByRole("option", { name: "Skip matching records" }),
		);
		expect(onImportStrategy).toHaveBeenCalledWith("skip");
	});

	it("renders sidebar session actions and hides session-only panels when no chat is active", async () => {
		const user = userEvent.setup();
		const onConfigure = vi.fn();
		const onDelete = vi.fn();
		const onNew = vi.fn();
		const onRename = vi.fn();
		const onRestore = vi.fn();

		const { rerender } = render(
			<SidebarContent
				view={{
					conversations: [],
					provider: null,
					tactics: null,
				}}
				onConfigure={onConfigure}
				onDeleteConversation={onDelete}
				onNewChat={onNew}
				onRenameConversation={onRename}
				onRestoreConversation={onRestore}
			/>,
		);

		expect(screen.getByText("No saved chats yet")).toBeInTheDocument();
		expect(screen.queryByText("Provider")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "New chat" }));
		await user.click(screen.getByRole("button", { name: "Configure" }));
		expect(onNew).toHaveBeenCalled();
		expect(onConfigure).toHaveBeenCalled();

		rerender(
			<SidebarContent
				view={{
					conversations: [
						{ id: "c1", title: "Morning", active: true },
						{ id: "c2", title: "Evening", active: false },
					],
					provider: {
						modelLabel: "model-a",
						baseUrlLabel: "http://provider.test",
						cacheLabel: "Usage tracking on / stable prompt",
						usage: {
							cacheHitLabel: "cache 50%",
							promptLabel: "100",
							cachedLabel: "50",
							completionLabel: "20",
						},
					},
					tactics: {
						day: 2,
						lastLoaded: [{ id: "calm", name: "Calm" }],
						allowed: [{ id: "brief", name: "Brief" }],
						userState: [{ key: "urgency", value: 40 }],
					},
				}}
				onConfigure={onConfigure}
				onDeleteConversation={onDelete}
				onNewChat={onNew}
				onRenameConversation={onRename}
				onRestoreConversation={onRestore}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Morning" }));
		await user.click(screen.getByRole("button", { name: "Rename Morning" }));
		await user.click(screen.getByRole("button", { name: "Delete Morning" }));
		expect(onRestore).toHaveBeenCalledWith("c1");
		expect(onRename).toHaveBeenCalledWith("c1");
		expect(onDelete).toHaveBeenCalledWith("c1");
		expect(screen.getByText("model-a")).toBeInTheDocument();
		expect(screen.getByText("Day 2")).toBeInTheDocument();
		expect(screen.getByText("Triggered last turn")).toBeInTheDocument();
		expect(screen.getByText("Enabled for session")).toBeInTheDocument();
		expect(screen.getByText("Calm")).toBeInTheDocument();
		expect(screen.getByText("Brief")).toBeInTheDocument();

		rerender(
			<SidebarContent
				view={{
					conversations: [{ id: "c1", title: "Morning", active: false }],
					provider: {
						modelLabel: "model-a",
						baseUrlLabel: "http://provider.test",
						cacheLabel: "Usage tracking off",
						usage: null,
					},
					tactics: {
						day: null,
						lastLoaded: [],
						allowed: [],
						userState: [],
					},
				}}
				onConfigure={onConfigure}
				onDeleteConversation={onDelete}
				onNewChat={onNew}
				onRenameConversation={onRename}
				onRestoreConversation={onRestore}
			/>,
		);
		expect(screen.queryByText("Day 2")).not.toBeInTheDocument();
		expect(
			screen.getByText("No tactic triggered in the last assistant turn"),
		).toBeInTheDocument();
		expect(
			screen.getByText("No tactics enabled for this session"),
		).toBeInTheDocument();
	});

	it("renders config modal tabs for settings, providers, and tactics", async () => {
		const user = userEvent.setup();
		const onSubmit = vi.fn();
		const onUpdate = vi.fn();
		const onUseProvider = vi.fn();
		const onEditProvider = vi.fn();
		const onDeleteProvider = vi.fn();
		const onNewProvider = vi.fn();
		const onEditTactic = vi.fn();
		const onDeleteTactic = vi.fn();
		const onNewTactic = vi.fn();
		const onDeleteState = vi.fn();
		const onSaveState = vi.fn();
		vi.spyOn(crypto, "randomUUID").mockReturnValue(
			"11111111-1111-4111-8111-111111111111",
		);

		render(
			<ConfigModal
				open={true}
				error="Config warning"
				saving={false}
				draft={{
					defaultModel: "model-a",
					temperature: "0.7",
					thinkingLevel: "off",
					systemPrompt: "System",
					systemPromptCache: true,
					compactionEnabled: true,
					compactionTriggerTokens: "1000",
					compactionKeepRecentTokens: "100",
				}}
				view={{
					activeModelLabel: "Active model",
					modelOptions: [{ label: "Model A", value: "model-a" }],
					thinkingLevelOptions: [
						{ label: "Off", value: "off" },
						{ label: "High", value: "high" },
					],
					providers: [
						{
							id: "local",
							name: "Local",
							baseUrl: "http://provider.test",
							modelsLabel: "model-a",
							active: true,
						},
						{
							id: "other",
							name: "Other",
							baseUrl: "http://other.test",
							modelsLabel: "model-b",
							active: false,
						},
					],
					tactics: [
						{
							id: "calm",
							name: "Calm",
							keywordsLabel: "please",
						},
					],
					states: [
						{
							id: "urgency",
							name: "Urgency",
							description: "Need for a direct answer.",
							defaultValue: 40,
						},
					],
				}}
				onDeleteState={onDeleteState}
				onDeleteProvider={onDeleteProvider}
				onDeleteTactic={onDeleteTactic}
				onEditProvider={onEditProvider}
				onEditTactic={onEditTactic}
				onNewProvider={onNewProvider}
				onNewTactic={onNewTactic}
				onOpenChange={vi.fn()}
				onSaveState={onSaveState}
				onSubmit={onSubmit}
				onUpdate={onUpdate}
				onUseProvider={onUseProvider}
			/>,
		);

		expect(screen.getByText("Configuration")).toBeInTheDocument();
		await user.type(screen.getByLabelText("Temperature"), "1");
		await user.click(screen.getByRole("combobox", { name: "Active model" }));
		await user.click(await screen.findByRole("option", { name: "Model A" }));
		await user.click(screen.getByRole("combobox", { name: "Reasoning level" }));
		await user.click(await screen.findByRole("option", { name: "High" }));
		await user.click(screen.getByRole("button", { name: "Save" }));
		expect(onUpdate).toHaveBeenCalled();
		expect(onSubmit).toHaveBeenCalled();

		await user.click(screen.getByRole("tab", { name: "Providers" }));
		await user.click(screen.getByRole("button", { name: "New provider" }));
		const otherRow = screen.getByText("Other").closest("div")?.parentElement;
		expect(otherRow).toBeTruthy();
		await user.click(
			within(otherRow as HTMLElement).getByRole("button", { name: "Use" }),
		);
		await user.click(
			within(otherRow as HTMLElement).getByRole("button", { name: "Edit" }),
		);
		await user.click(
			within(otherRow as HTMLElement).getByRole("button", { name: "Delete" }),
		);
		expect(onNewProvider).toHaveBeenCalled();
		expect(onUseProvider).toHaveBeenCalledWith("other");
		expect(onEditProvider).toHaveBeenCalledWith("other");
		expect(onDeleteProvider).toHaveBeenCalledWith("other");

		await user.click(screen.getByRole("tab", { name: "Tactics" }));
		await user.click(screen.getByRole("button", { name: "New tactic" }));
		await user.click(screen.getByRole("button", { name: "Edit" }));
		await user.click(screen.getByRole("button", { name: "Delete" }));
		expect(onNewTactic).toHaveBeenCalled();
		expect(onEditTactic).toHaveBeenCalledWith("calm");
		expect(onDeleteTactic).toHaveBeenCalledWith("calm");

		await user.click(screen.getByRole("tab", { name: "States" }));
		expect(screen.queryByLabelText("State id")).not.toBeInTheDocument();
		const stateRow = screen.getByText("Urgency").closest("div")?.parentElement;
		expect(stateRow).toBeTruthy();
		await user.click(
			within(stateRow as HTMLElement).getByRole("button", { name: "Edit" }),
		);
		await user.click(screen.getByRole("button", { name: "Save state" }));
		expect(onSaveState).toHaveBeenCalledWith(
			expect.objectContaining({ id: "urgency", name: "Urgency" }),
			"urgency",
		);
		await user.click(
			within(stateRow as HTMLElement).getByRole("button", { name: "Delete" }),
		);
		expect(onDeleteState).toHaveBeenCalledWith("urgency");
		await user.click(screen.getByRole("button", { name: "New state" }));
		expect(screen.queryByLabelText("State id")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("Low label")).not.toBeInTheDocument();
		expect(screen.queryByLabelText("High label")).not.toBeInTheDocument();
		await user.type(screen.getByLabelText("Name"), "!");
		await user.type(screen.getByLabelText("Default value"), "5");
		await user.type(screen.getByLabelText("Description"), "desc");
		await user.click(screen.getByRole("button", { name: "Save state" }));
		expect(onSaveState).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "11111111-1111-4111-8111-111111111111",
				name: "New state!",
			}),
			null,
		);
		await user.click(screen.getByRole("button", { name: "Cancel" }));
	});

	it("edits settings through the text-field model branch and compact options", async () => {
		const user = userEvent.setup();
		const onUpdate = vi.fn();
		const draft = {
			defaultModel: "custom-model",
			temperature: "0.7",
			thinkingLevel: "off",
			systemPrompt: "System",
			systemPromptCache: false,
			compactionEnabled: false,
			compactionTriggerTokens: "1000",
			compactionKeepRecentTokens: "100",
		};

		render(
			<ConfigModal
				open={true}
				error=""
				saving={true}
				draft={draft}
				view={{
					activeModelLabel: "Active model",
					modelOptions: [],
					thinkingLevelOptions: [
						{ label: "Off", value: "off" },
						{ label: "High", value: "high" },
					],
					providers: [],
					tactics: [],
					states: [],
				}}
				onDeleteState={vi.fn()}
				onDeleteProvider={vi.fn()}
				onDeleteTactic={vi.fn()}
				onEditProvider={vi.fn()}
				onEditTactic={vi.fn()}
				onNewProvider={vi.fn()}
				onNewTactic={vi.fn()}
				onOpenChange={vi.fn()}
				onSaveState={vi.fn()}
				onSubmit={vi.fn()}
				onUpdate={onUpdate}
				onUseProvider={vi.fn()}
			/>,
		);

		await user.type(screen.getByLabelText("Active model"), "-next");
		await user.type(screen.getByLabelText("System prompt"), "!");
		await user.click(
			screen.getByRole("switch", { name: "Mark system prompt as stable" }),
		);
		await user.click(
			screen.getByRole("switch", { name: "Auto compact long chats" }),
		);
		await user.type(screen.getByLabelText("Compact trigger tokens"), "1");
		await user.type(screen.getByLabelText("Keep recent tokens"), "1");
		expect(onUpdate).toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled();
	});

	it("renders empty config states and closed editor modals without business data", () => {
		const { container } = render(
			<div>
				<ConfigModal
					open={true}
					error=""
					saving={true}
					draft={null}
					view={{
						activeModelLabel: "Active model",
						modelOptions: [],
						thinkingLevelOptions: [],
						providers: null,
						tactics: [],
						states: [],
					}}
					onDeleteState={vi.fn()}
					onDeleteProvider={vi.fn()}
					onDeleteTactic={vi.fn()}
					onEditProvider={vi.fn()}
					onEditTactic={vi.fn()}
					onNewProvider={vi.fn()}
					onNewTactic={vi.fn()}
					onOpenChange={vi.fn()}
					onSaveState={vi.fn()}
					onSubmit={vi.fn()}
					onUpdate={vi.fn()}
					onUseProvider={vi.fn()}
				/>
				<ProviderEditModal
					draft={null}
					error=""
					open={false}
					saving={false}
					testOpen={false}
					testResult={null}
					testing={false}
					onChange={vi.fn()}
					onOpenChange={vi.fn()}
					onSave={vi.fn()}
					onTest={vi.fn()}
					onTestOpenChange={vi.fn()}
				/>
				<TacticEditModal
					draft={null}
					error=""
					open={false}
					saving={false}
					stateDefinitions={stateDefinitions}
					onChange={vi.fn()}
					onOpenChange={vi.fn()}
					onSave={vi.fn()}
				/>
			</div>,
		);

		expect(screen.getByText("Configuration")).toBeInTheDocument();
		expect(container).toBeTruthy();
	});

	it("renders empty provider and tactic library states in configuration", async () => {
		const user = userEvent.setup();
		render(
			<ConfigModal
				open={true}
				error=""
				saving={false}
				draft={null}
				view={{
					activeModelLabel: "Active model",
					modelOptions: [],
					thinkingLevelOptions: [],
					providers: null,
					tactics: [],
					states: [],
				}}
				onDeleteState={vi.fn()}
				onDeleteProvider={vi.fn()}
				onDeleteTactic={vi.fn()}
				onEditProvider={vi.fn()}
				onEditTactic={vi.fn()}
				onNewProvider={vi.fn()}
				onNewTactic={vi.fn()}
				onOpenChange={vi.fn()}
				onSaveState={vi.fn()}
				onSubmit={vi.fn()}
				onUpdate={vi.fn()}
				onUseProvider={vi.fn()}
			/>,
		);

		await user.click(screen.getByRole("tab", { name: "Providers" }));
		expect(screen.getByText("Loading providers.")).toBeInTheDocument();
		await user.click(screen.getByRole("tab", { name: "Tactics" }));
		expect(screen.getByText("No tactics yet.")).toBeInTheDocument();
		await user.click(screen.getByRole("tab", { name: "States" }));
		expect(screen.getByText("No states yet.")).toBeInTheDocument();
	});

	it("renders state configuration error, saving state, and optional descriptions", async () => {
		const user = userEvent.setup();
		render(
			<ConfigModal
				open={true}
				error="State warning"
				saving={true}
				draft={null}
				view={{
					activeModelLabel: "Active model",
					modelOptions: [],
					thinkingLevelOptions: [],
					providers: [],
					tactics: [],
					states: [
						{
							id: "energy",
							name: "Energy",
							description: "",
							defaultValue: 50,
						},
					],
				}}
				onDeleteState={vi.fn()}
				onDeleteProvider={vi.fn()}
				onDeleteTactic={vi.fn()}
				onEditProvider={vi.fn()}
				onEditTactic={vi.fn()}
				onNewProvider={vi.fn()}
				onNewTactic={vi.fn()}
				onOpenChange={vi.fn()}
				onSaveState={vi.fn()}
				onSubmit={vi.fn()}
				onUpdate={vi.fn()}
				onUseProvider={vi.fn()}
			/>,
		);

		await user.click(screen.getByRole("tab", { name: "States" }));
		expect(screen.getByText("State warning")).toBeInTheDocument();
		expect(screen.getByText("Default 50")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Edit" }));
		expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled();
	});

	it("confirms or cancels destructive conversation deletion", async () => {
		const user = userEvent.setup();
		const onCancel = vi.fn();
		const onConfirm = vi.fn();
		const conversation = {
			id: "c1",
			title: "Morning",
			profile: {
				assistantName: "Ava",
				userRole: "User",
				assistantRole: "Assistant",
			},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			messageCount: 1,
		};

		const { rerender } = render(
			<DeleteConversationModal
				conversation={null}
				deleting={false}
				onCancel={onCancel}
				onConfirm={onConfirm}
			/>,
		);
		expect(screen.queryByText("Delete session")).not.toBeInTheDocument();

		rerender(
			<DeleteConversationModal
				conversation={conversation}
				deleting={true}
				onCancel={onCancel}
				onConfirm={onConfirm}
			/>,
		);
		expect(screen.getByRole("button", { name: "Deleting" })).toBeDisabled();
		await user.keyboard("{Escape}");
		expect(onCancel).toHaveBeenCalled();

		rerender(
			<DeleteConversationModal
				conversation={conversation}
				deleting={false}
				onCancel={onCancel}
				onConfirm={onConfirm}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		await user.click(screen.getByRole("button", { name: "Delete" }));
		expect(onCancel).toHaveBeenCalled();
		expect(onConfirm).toHaveBeenCalled();
	});

	it("renames a conversation through a focused modal", async () => {
		const user = userEvent.setup();
		const onCancel = vi.fn();
		const onConfirm = vi.fn();
		const onTitleChange = vi.fn();
		const conversation = {
			id: "c1",
			title: "Morning",
			profile: {
				assistantName: "Ava",
				userRole: "User",
				assistantRole: "Assistant",
			},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			messageCount: 1,
		};

		const { rerender } = render(
			<RenameConversationModal
				conversation={null}
				renaming={false}
				title=""
				onCancel={onCancel}
				onConfirm={onConfirm}
				onTitleChange={onTitleChange}
			/>,
		);
		expect(screen.queryByText("Rename session")).not.toBeInTheDocument();

		rerender(
			<RenameConversationModal
				conversation={conversation}
				renaming={false}
				title="Morning"
				onCancel={onCancel}
				onConfirm={onConfirm}
				onTitleChange={onTitleChange}
			/>,
		);
		await user.type(screen.getByLabelText("Session name"), "!");
		await user.click(screen.getByRole("button", { name: "Rename" }));
		expect(onTitleChange).toHaveBeenCalled();
		expect(onConfirm).toHaveBeenCalled();

		rerender(
			<RenameConversationModal
				conversation={conversation}
				renaming={true}
				title="Morning"
				onCancel={onCancel}
				onConfirm={onConfirm}
				onTitleChange={onTitleChange}
			/>,
		);
		expect(screen.getByRole("button", { name: "Renaming" })).toBeDisabled();
		await user.keyboard("{Escape}");
		expect(onCancel).toHaveBeenCalled();
	});

	it("starts a new chat from a session profile and locked tactic choices", async () => {
		const user = userEvent.setup();
		const onDraftChange = vi.fn();
		const onToggle = vi.fn();
		const onStateToggle = vi.fn();
		const onStart = vi.fn();

		render(
			<NewChatModal
				open={true}
				draft={{
					title: "Morning",
					assistantName: "Ava",
					userRole: "User",
					assistantRole: "Assistant",
					tactics: true,
					dayProgression: false,
					sessionState: true,
					sceneEvents: false,
				}}
				error="Choose carefully"
				saving={false}
				selectedTacticIds={["calm"]}
				tactics={[
					{
						id: "calm",
						name: "Calm",
						keywords: [],
						emotionRules: [],
						blockedKeywords: [],
						instruction: "Stay calm.",
						allowedInSession: true,
						requiredStateIds: ["urgency"],
					},
				]}
				stateDefinitions={stateDefinitions}
				selectedStateIds={["urgency", "confidence-needed"]}
				onDraftChange={onDraftChange}
				onOpenChange={vi.fn()}
				onStart={onStart}
				onStateToggle={onStateToggle}
				onToggle={onToggle}
			/>,
		);

		await user.type(screen.getByLabelText("Session name"), "!");
		await user.type(screen.getByLabelText("Violoop name"), "!");
		await user.type(screen.getByLabelText("Your role in this chat"), "!");
		await user.type(screen.getByLabelText("Violoop role in this chat"), "!");
		await user.click(screen.getByRole("checkbox", { name: "Tactics" }));
		await user.click(screen.getByRole("checkbox", { name: "Day progression" }));
		await user.click(screen.getByRole("checkbox", { name: "Session state" }));
		await user.click(screen.getByRole("checkbox", { name: "Scene events" }));
		await user.click(screen.getByRole("checkbox", { name: "Calm" }));
		await user.click(
			screen.getByRole("checkbox", { name: "Urgency / required" }),
		);
		await user.click(screen.getByRole("checkbox", { name: "Session state" }));
		await user.click(screen.getByRole("button", { name: "Start chat" }));
		expect(onDraftChange).toHaveBeenCalled();
		expect(onToggle).toHaveBeenCalledWith("calm", false);
		expect(onStateToggle).toHaveBeenCalledWith("urgency", true);
		expect(onDraftChange).toHaveBeenCalledWith(
			expect.objectContaining({ sessionState: true }),
		);
		expect(onStart).toHaveBeenCalled();
		expect(screen.getByText("Choose carefully")).toBeInTheDocument();
	});

	it("shows disabled runtime sections for generic new chats", () => {
		render(
			<NewChatModal
				open={true}
				draft={{
					title: "Generic",
					assistantName: "Violoop",
					userRole: "User",
					assistantRole: "Assistant",
					tactics: false,
					dayProgression: false,
					sessionState: false,
					sceneEvents: false,
				}}
				error=""
				saving={false}
				selectedTacticIds={[]}
				tactics={[
					{
						id: "calm",
						name: "Calm",
						keywords: [],
						emotionRules: [],
						blockedKeywords: [],
						instruction: "Stay calm.",
						allowedInSession: false,
						requiredStateIds: [],
					},
				]}
				stateDefinitions={stateDefinitions}
				selectedStateIds={[]}
				onDraftChange={vi.fn()}
				onOpenChange={vi.fn()}
				onStart={vi.fn()}
				onStateToggle={vi.fn()}
				onToggle={vi.fn()}
			/>,
		);

		expect(
			screen.getByText("Tactics are disabled for this session."),
		).toBeInTheDocument();
		expect(
			screen.getByText("Session state is disabled for this session."),
		).toBeInTheDocument();
	});

	it("shows an empty-state message when session state is enabled without definitions", () => {
		render(
			<NewChatModal
				open={true}
				draft={{
					title: "Stateful",
					assistantName: "Violoop",
					userRole: "User",
					assistantRole: "Assistant",
					tactics: true,
					dayProgression: false,
					sessionState: true,
					sceneEvents: false,
				}}
				error=""
				saving={false}
				selectedTacticIds={[]}
				tactics={[]}
				stateDefinitions={[]}
				selectedStateIds={[]}
				onDraftChange={vi.fn()}
				onOpenChange={vi.fn()}
				onStart={vi.fn()}
				onStateToggle={vi.fn()}
				onToggle={vi.fn()}
			/>,
		);

		expect(
			screen.getByText("No session states are configured."),
		).toBeInTheDocument();
	});

	it("allows non-required session states to be toggled normally", async () => {
		const user = userEvent.setup();
		const onDraftChange = vi.fn();
		const onStateToggle = vi.fn();
		render(
			<NewChatModal
				open={true}
				draft={{
					title: "Stateful",
					assistantName: "Violoop",
					userRole: "User",
					assistantRole: "Assistant",
					tactics: true,
					dayProgression: false,
					sessionState: true,
					sceneEvents: false,
				}}
				error=""
				saving={false}
				selectedTacticIds={[]}
				tactics={[]}
				stateDefinitions={stateDefinitions}
				selectedStateIds={["urgency"]}
				onDraftChange={onDraftChange}
				onOpenChange={vi.fn()}
				onStart={vi.fn()}
				onStateToggle={onStateToggle}
				onToggle={vi.fn()}
			/>,
		);

		await user.click(screen.getByRole("checkbox", { name: "Session state" }));
		await user.click(screen.getByRole("checkbox", { name: "Urgency" }));

		expect(onDraftChange).toHaveBeenCalledWith(
			expect.objectContaining({ sessionState: false }),
		);
		expect(onStateToggle).toHaveBeenCalledWith("urgency", false);
	});

	it("edits provider settings and requests provider tests before saving", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		const onSave = vi.fn();
		const onTest = vi.fn();
		const draft = {
			...newProviderEditorDraft(),
			baseUrl: "http://provider.test",
			models: "model-a",
		};

		render(
			<ProviderEditModal
				draft={draft}
				error="Provider warning"
				open={true}
				saving={false}
				testOpen={true}
				testResult={{
					status: "success",
					title: "Provider is available",
					detail: "model-a / pong",
				}}
				testing={false}
				onChange={onChange}
				onOpenChange={vi.fn()}
				onSave={onSave}
				onTest={onTest}
				onTestOpenChange={vi.fn()}
			/>,
		);

		await user.type(screen.getByLabelText("Provider name"), "!");
		await user.type(screen.getByLabelText("Base URL"), "/v1");
		await user.type(screen.getByLabelText("API key"), "secret");
		await user.type(
			screen.getByLabelText("Models, comma separated"),
			", model-b",
		);
		await user.click(
			screen.getByRole("switch", { name: "Send Authorization header" }),
		);
		await user.click(
			screen.getByRole("switch", { name: "Use developer role for prompt" }),
		);
		await user.click(
			screen.getByRole("switch", { name: "Request streaming usage" }),
		);
		await user.click(
			screen.getByRole("switch", { name: "Supports reasoning effort" }),
		);
		await user.click(screen.getByRole("combobox", { name: "Thinking format" }));
		await user.click(
			await screen.findByRole("option", {
				name: "OpenRouter reasoning.effort",
			}),
		);
		await user.click(
			screen.getByRole("combobox", { name: "Cache control format" }),
		);
		await user.click(
			await screen.findByRole("option", {
				name: "Anthropic-style cache_control",
			}),
		);
		await user.click(screen.getByRole("button", { name: "Test" }));
		await user.click(screen.getByRole("button", { name: "Save provider" }));
		expect(onChange).toHaveBeenCalled();
		expect(onTest).toHaveBeenCalledWith(draft);
		expect(onSave).toHaveBeenCalledWith(draft);
		expect(screen.getByText("Provider warning")).toBeInTheDocument();
		expect(screen.getByText("model-a / pong")).toBeInTheDocument();
	});

	it("shows provider edit progress states and allows clearing cache-control format", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		const draft = {
			...newProviderEditorDraft(),
			originalId: "local",
			id: "local",
			name: "Local",
			baseUrl: "http://provider.test",
			models: "model-a",
			cacheControlFormat: "anthropic" as const,
		};
		const { rerender } = render(
			<ProviderEditModal
				draft={draft}
				error=""
				open={true}
				saving={false}
				testOpen={false}
				testResult={null}
				testing={false}
				onChange={onChange}
				onOpenChange={vi.fn()}
				onSave={vi.fn()}
				onTest={vi.fn()}
				onTestOpenChange={vi.fn()}
			/>,
		);

		expect(screen.getByText("Edit provider")).toBeInTheDocument();
		await user.click(
			screen.getByRole("combobox", { name: "Cache control format" }),
		);
		await user.click(await screen.findByRole("option", { name: "None" }));
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({ cacheControlFormat: "" }),
		);

		rerender(
			<ProviderEditModal
				draft={draft}
				error=""
				open={true}
				saving={true}
				testOpen={false}
				testResult={null}
				testing={true}
				onChange={onChange}
				onOpenChange={vi.fn()}
				onSave={vi.fn()}
				onTest={vi.fn()}
				onTestOpenChange={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: "Testing" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled();
	});

	it("edits tactic trigger rules and saves tactic instructions", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		const onSave = vi.fn();
		const draft = {
			...newTacticEditorDraft(),
			emotionRules: [
				{ key: "urgency" as const, operator: ">=" as const, value: "60" },
			],
		};

		render(
			<TacticEditModal
				draft={draft}
				error="Tactic warning"
				open={true}
				saving={false}
				stateDefinitions={stateDefinitions}
				onChange={onChange}
				onOpenChange={vi.fn()}
				onSave={onSave}
			/>,
		);

		await user.type(screen.getByLabelText("Name"), "!");
		await user.type(
			screen.getByLabelText("Trigger keywords, comma separated"),
			"please",
		);
		await user.click(screen.getByRole("combobox", { name: "State" }));
		await user.click(
			await screen.findByRole("option", { name: "Confidence needed" }),
		);
		await user.click(screen.getByRole("combobox", { name: "When" }));
		await user.click(await screen.findByRole("option", { name: "At most" }));
		await user.click(screen.getByRole("button", { name: "Add rule" }));
		await user.type(screen.getByLabelText("Value"), "1");
		await user.click(screen.getByRole("button", { name: "Remove" }));
		await user.type(
			screen.getByLabelText("Do not use when message contains"),
			"stop",
		);
		await user.type(screen.getByLabelText("Instruction"), "Help");
		await user.click(screen.getByRole("button", { name: "Save tactic" }));
		expect(onChange).toHaveBeenCalled();
		expect(onSave).toHaveBeenCalledWith(draft);
		expect(screen.getByText("Tactic warning")).toBeInTheDocument();
	});

	it("edits existing tactic rules without mutating unrelated rules and shows saving state", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		const draft = {
			...newTacticEditorDraft(),
			originalId: "calm",
			id: "calm",
			name: "Calm",
			emotionRules: [
				{ key: "urgency" as const, operator: ">=" as const, value: "60" },
				{ key: "stress" as const, operator: "<=" as const, value: "30" },
			],
		};
		render(
			<TacticEditModal
				draft={draft}
				error=""
				open={true}
				saving={true}
				stateDefinitions={stateDefinitions}
				onChange={onChange}
				onOpenChange={vi.fn()}
				onSave={vi.fn()}
			/>,
		);

		expect(screen.getByText("Edit tactic")).toBeInTheDocument();
		await user.click(screen.getAllByRole("combobox", { name: "State" })[1]);
		await user.click(
			await screen.findByRole("option", { name: "Confidence needed" }),
		);
		expect(onChange).toHaveBeenCalledWith(
			expect.objectContaining({
				emotionRules: [
					{ key: "urgency", operator: ">=", value: "60" },
					{ key: "confidence-needed", operator: "<=", value: "30" },
				],
			}),
		);
		expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled();
	});

	it("keeps tactic rule creation inert when no session states are configured", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(
			<TacticEditModal
				draft={newTacticEditorDraft()}
				error=""
				open={true}
				saving={false}
				stateDefinitions={[]}
				onChange={onChange}
				onOpenChange={vi.fn()}
				onSave={vi.fn()}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Add rule" }));
		expect(onChange).not.toHaveBeenCalled();
		expect(screen.getByText("No state trigger rules.")).toBeInTheDocument();
	});

	it("runs the app shell through session, menu, configure, and delete flows", async () => {
		const user = userEvent.setup();
		const profile = {
			assistantName: "Ava",
			userRole: "User",
			assistantRole: "Assistant",
		};
		const conversation = {
			id: "c1",
			title: "Morning",
			profile,
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			messageCount: 1,
		};
		const clock = {
			conversationId: "c1",
			day: 1,
			updatedAt: "2026-01-01T00:00:00.000Z",
		};
		const tactic = {
			id: "calm",
			name: "Calm",
			keywords: ["please"],
			emotionRules: [],
			blockedKeywords: [],
			instruction: "Stay calm.",
			allowedInSession: true,
			requiredStateIds: [],
		};
		const appConfig = {
			chat: {
				defaultProvider: "local",
				defaultModel: "model-a",
				systemPrompt: "System",
				compaction: {
					enabled: true,
					triggerTokens: 1000,
					keepRecentTokens: 100,
				},
			},
			providers: {
				local: {
					name: "Local",
					baseUrl: "http://provider.test",
					api: "openai-completions",
					models: [{ id: "model-a" }],
				},
			},
		};
		const tacticsPayload = {
			conversationId: "c1",
			tactics: [tactic],
			stateDefinitions,
			userState: [],
			clock,
			recentRuns: [],
		};

		vi.mocked(loadConfig).mockResolvedValue({
			config: appConfig,
			provider: "local",
			providerName: "Local",
			baseUrl: "http://provider.test",
			api: "openai-completions",
			model: "model-a",
			cache: { systemPrompt: true, usageInStreaming: true },
		});
		vi.mocked(listConversations).mockResolvedValue([conversation]);
		vi.mocked(getConversation).mockResolvedValue({
			conversation,
			clock,
			timelineItems: [
				{
					id: "m1",
					conversationId: "c1",
					kind: "chat",
					role: "assistant",
					speakerName: "Ava",
					content: "Welcome",
					promptVisibility: "visible",
					createdAt: "2026-01-01T00:00:00.000Z",
				},
			],
		});
		vi.mocked(createLocalConversation).mockResolvedValue({
			conversation,
			clock,
			timelineItems: [],
		});
		vi.mocked(deleteConversation).mockResolvedValue([]);
		vi.mocked(fetchTacticsStatus).mockResolvedValue(tacticsPayload);

		render(<App />);

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Morning" }),
			).toBeInTheDocument();
		});
		await user.click(screen.getByRole("button", { name: "Morning" }));
		await waitFor(() => {
			expect(screen.getByText("Welcome")).toBeInTheDocument();
		});

		await user.click(screen.getByRole("button", { name: "Open menu" }));
		const mobileConfigureButton = screen
			.getAllByRole("button", { name: "Configure" })
			.at(-1);
		expect(mobileConfigureButton).toBeDefined();
		await user.click(mobileConfigureButton as HTMLElement);
		expect(await screen.findByText("Configuration")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Close" }));

		await user.click(screen.getAllByRole("button", { name: "New chat" })[0]);
		expect(
			await screen.findByRole("dialog", { name: "New chat" }),
		).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Start chat" }));
		await waitFor(() => {
			expect(
				screen.queryByRole("dialog", { name: "New chat" }),
			).not.toBeInTheDocument();
		});

		await user.click(screen.getByRole("button", { name: "Delete Morning" }));
		await user.click(await screen.findByRole("button", { name: "Delete" }));
		expect(deleteConversation).toHaveBeenCalled();
	});
});
