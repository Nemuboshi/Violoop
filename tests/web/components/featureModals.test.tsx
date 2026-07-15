// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../../src/web/app/App";
import {
	deleteConversation,
	getConversation,
	listConversations,
} from "../../../src/web/entities/conversation";
import { loadTacticsStatus } from "../../../src/web/entities/tactic";
import { createLocalConversation } from "../../../src/web/features/chat-session/api/createLocalConversation";
import { loadConfig } from "../../../src/web/features/config-settings/api/configApi";
import {
	DeleteConversationModal,
	RenameConversationModal,
} from "../../../src/web/features/conversation-management";
import { NewChatModal } from "../../../src/web/features/new-chat";
import {
	newProviderEditorDraft,
	ProviderEditModal,
} from "../../../src/web/features/provider-management";
import {
	newTacticEditorDraft,
	TacticEditModal,
} from "../../../src/web/features/tactic-management";

vi.mock("../../../src/web/entities/conversation", () => ({
	deleteConversation: vi.fn(),
	getConversation: vi.fn(),
	listConversations: vi.fn(),
	renameConversation: vi.fn(),
}));

vi.mock("../../../src/web/entities/tactic", () => ({
	deleteStateDefinition: vi.fn(),
	deleteTactic: vi.fn(),
	loadTacticsStatus: vi.fn(),
	saveStateDefinition: vi.fn(),
	saveTactic: vi.fn(),
}));

vi.mock("../../../src/web/features/config-settings/api/configApi", () => ({
	loadConfig: vi.fn(),
	saveConfig: vi.fn(),
}));

vi.mock(
	"../../../src/web/features/chat-session/api/createLocalConversation",
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
		vi.mocked(loadTacticsStatus).mockResolvedValue(tacticsPayload);

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
