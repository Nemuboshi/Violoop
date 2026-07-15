// @vitest-environment jsdom

import { Dialog } from "@base-ui/react/dialog";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderEditModal } from "../../../src/web/features/provider-management";
import { TacticEditModal } from "../../../src/web/features/tactic-management";
import { ChatTimeline } from "../../../src/web/widgets/chat-panel";
import { ConfigModal } from "../../../src/web/widgets/config-modal";
import { ConfigSettingsTab } from "../../../src/web/widgets/config-modal/ui/ConfigSettingsTab";

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
});
