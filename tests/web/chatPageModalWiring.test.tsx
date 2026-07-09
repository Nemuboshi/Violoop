// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatPage from "../../src/web/pages/chat-page/ui/ChatPage";

const mockState = vi.hoisted(() => ({
	mode: "provider",
	closeProviderEditor: vi.fn(),
	saveProviderDraft: vi.fn(),
	testProviderDraft: vi.fn(),
	setProviderDraft: vi.fn(),
	setProviderTestOpen: vi.fn(),
	setTacticDraft: vi.fn(),
	saveTacticDraft: vi.fn(),
	saveStateDefinitionDraft: vi.fn(),
	deleteStateDefinition: vi.fn(),
	confirmDeleteConversation: vi.fn(),
	setConversationToDelete: vi.fn(),
	confirmRenameConversation: vi.fn(),
	setConversationToRename: vi.fn(),
	setRenameTitle: vi.fn(),
}));

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

const providerDraft = {
	originalId: "local",
	id: "local",
	name: "Local",
	baseUrl: "http://provider.test",
	models: "model-a",
	apiKey: "",
	authHeader: true,
	supportsDeveloperRole: false,
	supportsUsageInStreaming: true,
	supportsReasoningEffort: false,
	thinkingFormat: "",
	cacheControlFormat: "",
};

const tacticDraft = {
	id: "calm",
	originalId: "calm",
	name: "Calm",
	keywords: "please",
	instruction: "Stay calm.",
	emotionRules: [],
	blockedKeywords: "",
};

vi.mock("../../src/web/pages/chat-page/model/useChatPage", () => ({
	useChatPage: () => ({
		chatSession: {
			messages: [],
			activeConversationId: "c1",
			activeProfile: profile,
			canSend: false,
			draft: "",
			status: "idle",
			error: "",
			setDraft: vi.fn(),
		},
		chatTimelineItems: [],
		config: {
			config: null,
			open: false,
			draft: null,
			error: "",
			saving: false,
			providerDraft: mockState.mode === "provider" ? providerDraft : null,
			providerTestOpen: false,
			providerTestResult: null,
			testingProvider: false,
			openConfigModal: vi.fn(),
			setOpen: vi.fn(),
			deleteProvider: vi.fn(),
			activateProvider: vi.fn(),
			openProviderEditor: vi.fn(),
			openNewProviderEditor: vi.fn(),
			closeProviderEditor: mockState.closeProviderEditor,
			saveProviderDraft: mockState.saveProviderDraft,
			testProviderDraft: mockState.testProviderDraft,
			setProviderDraft: mockState.setProviderDraft,
			setProviderTestOpen: mockState.setProviderTestOpen,
			saveSettingsDraft: vi.fn(),
		},
		configModalView: {
			activeModelLabel: "Active model",
			modelOptions: [],
			thinkingLevelOptions: [],
			providers: [],
			tactics: [],
			states: [],
		},
		conversations: {
			conversations: [conversation],
			conversationToDelete: mockState.mode === "delete" ? conversation : null,
			conversationToRename: mockState.mode === "rename" ? conversation : null,
			deletingConversation: false,
			renamingConversation: false,
			renameTitle: "Morning",
			setConversationToDelete: mockState.setConversationToDelete,
			setConversationToRename: mockState.setConversationToRename,
			setRenameTitle: mockState.setRenameTitle,
			confirmRenameConversation: mockState.confirmRenameConversation,
		},
		newChat: {
			open: false,
			draft: { title: "Morning", ...profile },
			error: "",
			saving: false,
			selectedTacticIds: [],
			selectedStateIds: [],
			stateDefinitions: [],
			setDraft: vi.fn(),
			setOpen: vi.fn(),
			startNewConversation: vi.fn(),
			setTacticAllowed: vi.fn(),
			setStateEnabled: vi.fn(),
			openNewChatModal: vi.fn(),
		},
		tacticEditor: {
			tacticDraft: mockState.mode === "tactic" ? tacticDraft : null,
			savingTactic: false,
			deleteTactic: vi.fn(),
			deleteStateDefinition: mockState.deleteStateDefinition,
			openNewTacticEditor: vi.fn(),
			saveStateDefinitionDraft: mockState.saveStateDefinitionDraft,
			setTacticDraft: mockState.setTacticDraft,
			saveTacticDraft: mockState.saveTacticDraft,
		},
		tactics: {
			libraryTactics: [],
			selectedTacticIds: [],
			stateDefinitions: [],
			tacticsStatus: null,
		},
		sidebarView: { conversations: [], provider: null, tactics: null },
		sendMessage: vi.fn(),
		restoreConversation: vi.fn(),
		requestDeleteConversation: vi.fn(),
		requestRenameConversation: vi.fn(),
		confirmDeleteConversation: mockState.confirmDeleteConversation,
		handleComposerKeyDown: vi.fn(),
		openTacticEditor: vi.fn(),
		updateConfigSettingsDraft: vi.fn(),
	}),
}));

afterEach(() => {
	vi.clearAllMocks();
});

describe("chat page modal wiring", () => {
	it("routes provider editor close, test, and save actions", async () => {
		mockState.mode = "provider";
		const user = userEvent.setup();
		render(<ChatPage />);

		await user.click(screen.getByRole("button", { name: "Test" }));
		await user.click(screen.getByRole("button", { name: "Save provider" }));
		await user.click(screen.getByRole("button", { name: "Close" }));
		expect(mockState.testProviderDraft).toHaveBeenCalledWith(providerDraft);
		expect(mockState.saveProviderDraft).toHaveBeenCalledWith(providerDraft);
		expect(mockState.closeProviderEditor).toHaveBeenCalled();
	});

	it("routes tactic editor close and save actions", async () => {
		mockState.mode = "tactic";
		const user = userEvent.setup();
		render(<ChatPage />);

		await user.click(screen.getByRole("button", { name: "Save tactic" }));
		await user.click(screen.getByRole("button", { name: "Close" }));
		expect(mockState.saveTacticDraft).toHaveBeenCalledWith(tacticDraft);
		expect(mockState.setTacticDraft).toHaveBeenCalledWith(null);
	});

	it("routes delete confirmation and cancellation", async () => {
		mockState.mode = "delete";
		const user = userEvent.setup();
		render(<ChatPage />);

		await user.click(screen.getByRole("button", { name: "Cancel" }));
		await user.click(screen.getByRole("button", { name: "Delete" }));
		expect(mockState.setConversationToDelete).toHaveBeenCalledWith(null);
		expect(mockState.confirmDeleteConversation).toHaveBeenCalled();
	});

	it("routes rename edits, confirmation, and cancellation", async () => {
		mockState.mode = "rename";
		const user = userEvent.setup();
		render(<ChatPage />);

		await user.type(screen.getByLabelText("Session name"), "!");
		await user.click(screen.getByRole("button", { name: "Rename" }));
		await user.click(screen.getByRole("button", { name: "Close" }));
		expect(mockState.setRenameTitle).toHaveBeenCalled();
		expect(mockState.confirmRenameConversation).toHaveBeenCalled();
		expect(mockState.setConversationToRename).toHaveBeenCalledWith(null);
	});
});
