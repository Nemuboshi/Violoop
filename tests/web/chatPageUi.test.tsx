// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatPage from "../../src/web/pages/chat-page/ui/ChatPage";

const openConfigModal = vi.fn();
const openNewChatModal = vi.fn();
const restoreConversation = vi.fn();
const requestDeleteConversation = vi.fn();
const requestRenameConversation = vi.fn();
const deleteProvider = vi.fn();
const activateProvider = vi.fn();
const openProviderEditor = vi.fn();
const openNewProviderEditor = vi.fn();
const closeProviderEditor = vi.fn();
const saveProviderDraft = vi.fn();
const testProviderDraft = vi.fn();
const setProviderDraft = vi.fn();
const setProviderTestOpen = vi.fn();
const setConfigOpen = vi.fn();
const saveSettingsDraft = vi.fn();
const updateConfigSettingsDraft = vi.fn();
const deleteTactic = vi.fn();
const openTacticEditor = vi.fn();
const openNewTacticEditor = vi.fn();
const setTacticDraft = vi.fn();
const saveTacticDraft = vi.fn();
const saveStateDefinitionDraft = vi.fn();
const deleteStateDefinition = vi.fn();
const setNewChatDraft = vi.fn();
const setNewChatOpen = vi.fn();
const startNewConversation = vi.fn();
const setTacticAllowed = vi.fn();
const setStateEnabled = vi.fn();
const confirmDeleteConversation = vi.fn();
const setConversationToDelete = vi.fn();
const setConversationToRename = vi.fn();
const setRenameTitle = vi.fn();
const confirmRenameConversation = vi.fn();
const sendMessage = vi.fn();
const startEditingLastUserMessage = vi.fn();
const setEditingDraft = vi.fn();
const confirmLastUserMessageEdit = vi.fn();
const handleComposerKeyDown = vi.fn();

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

vi.mock("../../src/web/pages/chat-page/model/useChatPage", () => ({
	useChatPage: () => ({
		chatSession: {
			messages: [],
			visibleMessages: [],
			activeConversationId: "c1",
			activeProfile: conversation.profile,
			activeClock: {
				conversationId: "c1",
				day: 1,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
			canSend: true,
			draft: "hello",
			status: "idle",
			error: "Session warning",
			setDraft: vi.fn(),
			editingMessageId: null,
			editingDraft: "",
			setEditingDraft,
			lastEditableUserMessageId: "m1",
			startEditingLastUserMessage,
			lastUsage: null,
			lastTacticIds: [],
		},
		chatTimelineItems: [
			{
				id: "m1",
				itemClassName: "item",
				speakerClassName: "speaker",
				speaker: "Ava",
				contentClassName: "content",
				content: "Hello",
				editable: true,
			},
		],
		config: {
			config: null,
			open: true,
			draft: {
				defaultModel: "model-a",
				temperature: "0.7",
				thinkingLevel: "off",
				systemPrompt: "System",
				systemPromptCache: true,
				compactionEnabled: true,
				compactionTriggerTokens: "1000",
				compactionKeepRecentTokens: "100",
			},
			error: "Config warning",
			saving: false,
			providerDraft: null,
			providerTestOpen: true,
			providerTestResult: {
				status: "success",
				title: "Provider is available",
				detail: "model-a",
			},
			testingProvider: false,
			openConfigModal,
			setOpen: setConfigOpen,
			deleteProvider,
			activateProvider,
			openProviderEditor,
			openNewProviderEditor,
			closeProviderEditor,
			saveProviderDraft,
			testProviderDraft,
			setProviderDraft,
			setProviderTestOpen,
			saveSettingsDraft,
		},
		configModalView: {
			activeModelLabel: "Active model",
			modelOptions: [],
			thinkingLevelOptions: [{ label: "Off", value: "off" }],
			providers: [
				{
					id: "local",
					name: "Local",
					baseUrl: "http://provider.test",
					modelsLabel: "model-a",
					active: false,
				},
			],
			tactics: [{ id: "calm", name: "Calm", keywordsLabel: "please" }],
			states: [
				{
					id: "urgency",
					name: "Urgency",
					description: "",
					defaultValue: 40,
				},
			],
		},
		conversations: {
			conversations: [conversation],
			conversationToDelete: null,
			conversationToRename: null,
			deletingConversation: false,
			renamingConversation: false,
			renameTitle: "",
			setConversationToDelete,
			setConversationToRename,
			setRenameTitle,
			confirmRenameConversation,
		},
		newChat: {
			open: false,
			draft: { title: conversation.title, ...conversation.profile },
			error: "New chat warning",
			saving: false,
			selectedTacticIds: ["calm"],
			selectedStateIds: ["urgency"],
			stateDefinitions: [{ id: "urgency", name: "Urgency", defaultValue: 40 }],
			setDraft: setNewChatDraft,
			setOpen: setNewChatOpen,
			startNewConversation,
			setTacticAllowed,
			setStateEnabled,
			openNewChatModal,
		},
		tacticEditor: {
			tacticDraft: null,
			savingTactic: false,
			deleteTactic,
			deleteStateDefinition,
			openNewTacticEditor,
			saveStateDefinitionDraft,
			setTacticDraft,
			saveTacticDraft,
		},
		tactics: {
			libraryTactics: [
				{
					id: "calm",
					name: "Calm",
					keywords: ["please"],
					emotionRules: [],
					blockedKeywords: [],
					instruction: "Stay calm.",
					allowedInSession: true,
					requiredStateIds: ["urgency"],
				},
			],
			selectedTacticIds: ["calm"],
			stateDefinitions: [{ id: "urgency", name: "Urgency", defaultValue: 40 }],
			tacticsStatus: null,
		},
		sidebarView: {
			conversations: [{ id: "c1", title: "Morning", active: true }],
			provider: null,
			tactics: {
				day: 1,
				lastLoaded: [{ id: "calm", name: "Calm" }],
				allowed: [
					{ id: "calm", name: "Calm" },
					{ id: "focus", name: "Focus" },
				],
				userState: [{ key: "urgency", value: 40 }],
			},
		},
		sendMessage,
		confirmLastUserMessageEdit,
		restoreConversation,
		requestDeleteConversation,
		requestRenameConversation,
		confirmDeleteConversation,
		handleComposerKeyDown,
		openTacticEditor,
		updateConfigSettingsDraft,
	}),
}));

afterEach(() => {
	vi.clearAllMocks();
});

describe("chat page UI wiring", () => {
	it("connects sidebar, composer, config, provider, tactic, new chat, and delete actions", async () => {
		const user = userEvent.setup();
		render(<ChatPage />);

		const triggeredTactics = screen.getByRole("region", {
			name: "Triggered tactics from last turn",
			hidden: true,
		});
		expect(
			within(triggeredTactics).getByRole("heading", {
				name: "Triggered last turn",
				hidden: true,
			}),
		).toBeInTheDocument();
		expect(within(triggeredTactics).getByText("1 loaded")).toBeInTheDocument();
		expect(within(triggeredTactics).getByText("triggered")).toBeInTheDocument();
		const enabledTactics = screen.getByRole("region", {
			name: "Session-enabled tactics",
			hidden: true,
		});
		expect(
			within(enabledTactics).getByRole("heading", {
				name: "Enabled for session",
				hidden: true,
			}),
		).toBeInTheDocument();
		expect(within(enabledTactics).getByText("2 enabled")).toBeInTheDocument();
		expect(within(enabledTactics).getAllByText("enabled")).toHaveLength(2);

		fireEvent.click(
			screen.getByRole("button", { name: "Open menu", hidden: true }),
		);
		const mobileConfigureButton = screen
			.getAllByRole("button", { name: "Configure", hidden: true })
			.at(-1);
		const mobileNewChatButton = screen
			.getAllByRole("button", { name: "New chat", hidden: true })
			.at(-1);
		expect(mobileConfigureButton).toBeDefined();
		expect(mobileNewChatButton).toBeDefined();
		fireEvent.click(mobileConfigureButton as HTMLElement);
		fireEvent.click(mobileNewChatButton as HTMLElement);
		fireEvent.click(
			screen.getAllByRole("button", { name: "Morning", hidden: true })[0],
		);
		fireEvent.click(
			screen.getAllByRole("button", {
				name: "Rename Morning",
				hidden: true,
			})[0],
		);
		fireEvent.click(
			screen.getAllByRole("button", {
				name: "Delete Morning",
				hidden: true,
			})[0],
		);
		expect(openConfigModal).toHaveBeenCalled();
		expect(openNewChatModal).toHaveBeenCalled();
		expect(restoreConversation).toHaveBeenCalledWith("c1");
		expect(requestRenameConversation).toHaveBeenCalledWith("c1");
		expect(requestDeleteConversation).toHaveBeenCalledWith("c1");

		fireEvent.click(screen.getByRole("button", { name: "Send", hidden: true }));
		expect(sendMessage).toHaveBeenCalled();
		expect(screen.getByText("Session warning")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Edit", hidden: true }));
		expect(startEditingLastUserMessage).toHaveBeenCalledWith("m1", "Hello");

		await user.click(screen.getByRole("tab", { name: "Providers" }));
		const providerRow = screen.getByText("Local").closest("div")?.parentElement;
		expect(providerRow).toBeTruthy();
		await user.click(
			within(providerRow as HTMLElement).getByRole("button", { name: "Use" }),
		);
		await user.click(
			within(providerRow as HTMLElement).getByRole("button", { name: "Edit" }),
		);
		await user.click(
			within(providerRow as HTMLElement).getByRole("button", {
				name: "Delete",
			}),
		);
		await user.click(screen.getByRole("button", { name: "New provider" }));
		expect(activateProvider).toHaveBeenCalledWith("local");
		expect(openProviderEditor).toHaveBeenCalledWith("local");
		expect(deleteProvider).toHaveBeenCalledWith("local");
		expect(openNewProviderEditor).toHaveBeenCalled();

		await user.click(screen.getByRole("tab", { name: "Tactics" }));
		await user.click(screen.getByRole("button", { name: "New tactic" }));
		await user.click(screen.getByRole("button", { name: "Edit" }));
		await user.click(screen.getByRole("button", { name: "Delete" }));
		expect(openNewTacticEditor).toHaveBeenCalled();
		expect(openTacticEditor).toHaveBeenCalledWith("calm");
		expect(deleteTactic).toHaveBeenCalledWith("calm");

		await user.click(screen.getByRole("tab", { name: "States" }));
		const stateRow = screen.getByText("Urgency").closest("div")?.parentElement;
		expect(stateRow).toBeTruthy();
		await user.click(
			within(stateRow as HTMLElement).getByRole("button", { name: "Edit" }),
		);
		await user.click(screen.getByRole("button", { name: "Save state" }));
		expect(saveStateDefinitionDraft).toHaveBeenCalledWith(
			expect.objectContaining({ id: "urgency" }),
			"urgency",
		);
		await user.click(
			within(stateRow as HTMLElement).getByRole("button", { name: "Delete" }),
		);
		expect(deleteStateDefinition).toHaveBeenCalledWith("urgency");
	});
});
