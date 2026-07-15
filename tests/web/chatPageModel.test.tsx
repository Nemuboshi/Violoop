// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	deleteConversation,
	getConversation,
	listConversations,
	renameConversation,
} from "../../src/web/entities/conversation";
import {
	deleteStateDefinition,
	deleteTactic,
	fetchTacticsStatus,
	saveStateDefinition,
	saveTactic,
} from "../../src/web/entities/tactic";
import {
	editLastUserMessage,
	sendChatMessage,
} from "../../src/web/features/chat-session/api/chatApi";
import {
	loadConfig,
	saveConfig,
} from "../../src/web/features/config-settings/api/configApi";
import { useChatPage } from "../../src/web/pages/chat-page/model/useChatPage";

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

vi.mock("../../src/web/features/chat-session/api/chatApi", () => ({
	editLastUserMessage: vi.fn(),
	sendChatMessage: vi.fn(),
}));

function queueMock(
	fn: ReturnType<typeof vi.fn>,
	...responses: Array<unknown | (() => unknown)>
) {
	const queue = [...responses];
	fn.mockImplementation(async () => {
		const next = queue.shift();
		if (next === undefined) {
			throw new Error("Unexpected API call");
		}
		if (typeof next === "function") {
			return (next as () => unknown)();
		}
		return next;
	});
	return fn;
}

const profile = {
	assistantName: "Ava",
	userRole: "User",
	assistantRole: "Assistant",
};

const conversation = {
	id: "c1",
	title: "Morning",
	profile,
	capabilities: {
		tactics: true,
		dayProgression: true,
		sessionState: true,
		sceneEvents: true,
	},
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	messageCount: 2,
};

const clock = {
	conversationId: "c1",
	day: 3,
	updatedAt: "2026-01-01T00:00:00.000Z",
};

const config = {
	chat: {
		defaultProvider: "local",
		defaultModel: "model-a",
		systemPrompt: "System",
		temperature: 0.7,
		thinkingLevel: "off",
		cache: { systemPrompt: true },
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

const configResponse = {
	config,
	provider: "local",
	providerName: "Local",
	baseUrl: "http://provider.test",
	api: "openai-completions",
	model: "model-a",
	cache: { systemPrompt: true, usageInStreaming: true },
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

const stateDefinition = {
	id: "urgency",
	name: "Urgency",
	defaultValue: 40,
};

const timelineItems = [
	{
		id: "m1",
		conversationId: "c1",
		kind: "chat",
		role: "assistant",
		speakerName: "Ava",
		content: "Hello",
		promptVisibility: "visible",
		createdAt: "2026-01-01T00:00:00.000Z",
		usage: {
			promptTokens: 10,
			cachedPromptTokens: 5,
			completionTokens: 3,
			cacheHitRate: 0.5,
		},
	},
	{
		id: "hidden",
		conversationId: "c1",
		kind: "state_update",
		role: "system",
		content: "Hidden state",
		promptVisibility: "hidden",
		createdAt: "2026-01-01T00:00:00.000Z",
	},
];

beforeEach(() => {
	localStorage.clear();
	vi.mocked(deleteConversation).mockReset();
	vi.mocked(getConversation).mockReset();
	vi.mocked(listConversations).mockReset();
	vi.mocked(renameConversation).mockReset();
	vi.mocked(fetchTacticsStatus).mockReset();
	vi.mocked(saveTactic).mockReset();
	vi.mocked(deleteTactic).mockReset();
	vi.mocked(saveStateDefinition).mockReset();
	vi.mocked(deleteStateDefinition).mockReset();
	vi.mocked(loadConfig).mockReset();
	vi.mocked(saveConfig).mockReset();
	vi.mocked(sendChatMessage).mockReset();
	vi.mocked(editLastUserMessage).mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("chat page composition model", () => {
	it("restores the last active conversation from localStorage on load", async () => {
		localStorage.setItem("violoop.activeConversationId", "c1");
		vi.mocked(loadConfig).mockResolvedValue(configResponse as never);
		vi.mocked(listConversations).mockResolvedValue([conversation]);
		vi.mocked(getConversation).mockResolvedValue({
			conversation,
			clock,
			timelineItems: [],
		});
		vi.mocked(fetchTacticsStatus).mockResolvedValue({
			tactics: [tactic],
			stateDefinitions: [stateDefinition],
			userState: [],
			allowedTacticIds: ["calm"],
			recentRuns: [],
		} as never);
		const { result } = renderHook(() => useChatPage());
		await waitFor(() => {
			expect(result.current.chatSession.activeConversationId).toBe("c1");
		});
		expect(getConversation).toHaveBeenCalledWith("c1");
	});

	it("keeps selected-session panels stable while global config is still loading", () => {
		vi.mocked(loadConfig).mockImplementation(() => new Promise(() => {}));
		vi.mocked(listConversations).mockImplementation(
			() => new Promise(() => {}),
		);
		const { result } = renderHook(() => useChatPage());

		act(() => {
			result.current.chatSession.applyConversation({
				conversation: {
					...conversation,
					capabilities: {
						tactics: false,
						dayProgression: false,
						sessionState: false,
						sceneEvents: false,
					},
				},
				clock,
				timelineItems: [],
			});
			result.current.chatSession.setActiveClock(null);
		});

		expect(result.current.configModalView.modelOptions).toEqual([]);
		expect(result.current.configModalView.providers).toBeNull();
		expect(result.current.sidebarView.provider).toMatchObject({
			modelLabel: "loading",
			baseUrlLabel: "local API proxy",
			cacheLabel: "Usage tracking off",
			usage: null,
		});
		expect(result.current.sidebarView.tactics).toMatchObject({
			day: null,
			allowed: [],
			userState: [],
		});

		act(() => {
			result.current.chatSession.applyConversation({
				conversation: {
					...conversation,
					capabilities: {
						tactics: true,
						dayProgression: true,
						sessionState: true,
						sceneEvents: false,
					},
				},
				clock: null,
				timelineItems: [],
			});
		});
		expect(result.current.sidebarView.tactics).toMatchObject({
			day: null,
			allowed: [],
			userState: [],
		});
	});

	it("maps loaded app state into widget views and delegates page actions", async () => {
		queueMock(vi.mocked(loadConfig), configResponse);
		queueMock(vi.mocked(listConversations), [conversation], [conversation], []);
		queueMock(vi.mocked(getConversation), {
			conversation,
			clock,
			timelineItems,
		});
		queueMock(
			vi.mocked(fetchTacticsStatus),
			{
				conversationId: "c1",
				tactics: [tactic],
				stateDefinitions: [stateDefinition],
				userState: [
					{
						key: "urgency",
						value: 70,
						source: "inferred",
						confidence: 1,
						updatedAt: "now",
					},
				],
				clock,
				recentRuns: [],
			},
			{
				tactics: [tactic],
				stateDefinitions: [stateDefinition],
				userState: [],
				clock: null,
				recentRuns: [],
			},
			{
				conversationId: "c1",
				tactics: [tactic],
				stateDefinitions: [stateDefinition],
				userState: [],
				clock,
				recentRuns: [],
			},
		);
		queueMock(vi.mocked(sendChatMessage), {
			requestId: "r1",
			conversationId: "c1",
			tacticIds: ["ghost"],
			usage: { promptTokens: 5 },
			clock,
			timelineItems,
			createdItems: [],
		});
		queueMock(vi.mocked(deleteConversation), []);

		const { result } = renderHook(() => useChatPage());

		await waitFor(() => {
			expect(result.current.config.config?.model).toBe("model-a");
			expect(result.current.conversations.conversations).toHaveLength(1);
		});

		await act(async () => {
			result.current.restoreConversation("c1");
		});
		await waitFor(() => {
			expect(result.current.chatSession.activeConversationId).toBe("c1");
		});

		expect(result.current.chatTimelineItems).toHaveLength(1);
		expect(result.current.chatTimelineItems[0].speaker).toBe("Ava");
		expect(result.current.sidebarView.provider?.modelLabel).toBe("model-a");
		expect(result.current.sidebarView.provider?.usage?.cacheHitLabel).toBe(
			"50% cache hit",
		);
		expect(result.current.sidebarView.tactics?.day).toBe(3);
		expect(result.current.sidebarView.tactics?.allowed).toEqual([
			{ id: "calm", name: "Calm" },
		]);
		expect(result.current.configModalView.activeModelLabel).toBe(
			"Active model (Local)",
		);
		act(() => {
			result.current.chatSession.applyConversation({
				conversation,
				clock,
				timelineItems: [
					{
						...timelineItems[0],
						id: "u1",
						role: "user",
						speakerName: "You",
						content: "Editable prompt",
					},
				],
			});
		});
		act(() => {
			result.current.chatSession.startEditingLastUserMessage(
				"u1",
				"Editable prompt",
			);
			result.current.chatSession.setEditingDraft("Edited prompt");
		});
		expect(result.current.chatTimelineItems[0]).toMatchObject({
			editable: true,
			editing: true,
			editValue: "Edited prompt",
		});
		act(() => {
			result.current.chatSession.applyConversation({
				conversation,
				clock,
				timelineItems,
			});
		});

		act(() => {
			result.current.requestDeleteConversation("missing");
		});
		expect(result.current.conversations.conversationToDelete).toBeNull();

		act(() => {
			result.current.requestDeleteConversation("c1");
		});
		expect(result.current.conversations.conversationToDelete?.id).toBe("c1");

		act(() => {
			result.current.requestRenameConversation("missing");
		});
		expect(result.current.conversations.conversationToRename).toBeNull();

		act(() => {
			result.current.requestRenameConversation("c1");
		});
		expect(result.current.conversations.conversationToRename?.id).toBe("c1");
		expect(result.current.conversations.renameTitle).toBe("Morning");

		await act(async () => {
			await result.current.config.openConfigModal();
		});
		expect(result.current.configModalView.tactics).toEqual([
			{ id: "calm", name: "Calm", keywordsLabel: "please" },
		]);

		act(() => {
			result.current.openTacticEditor("missing");
		});
		expect(result.current.tacticEditor.tacticDraft).toBeNull();

		act(() => {
			result.current.openTacticEditor("calm");
		});
		expect(result.current.tacticEditor.tacticDraft?.id).toBe("calm");

		const settingsDraft = result.current.config.draft;
		expect(settingsDraft).not.toBeNull();
		if (!settingsDraft) {
			throw new Error("Expected config draft to be loaded.");
		}

		act(() => {
			result.current.updateConfigSettingsDraft({
				...settingsDraft,
				thinkingLevel: "bad-value",
			});
		});
		expect(result.current.config.draft?.thinkingLevel).toBe("off");

		const draftAfterInvalidInput = result.current.config.draft;
		expect(draftAfterInvalidInput).not.toBeNull();
		if (!draftAfterInvalidInput) {
			throw new Error("Expected config draft to remain loaded.");
		}

		act(() => {
			result.current.updateConfigSettingsDraft({
				...draftAfterInvalidInput,
				thinkingLevel: "high",
			});
		});
		expect(result.current.config.draft?.thinkingLevel).toBe("high");

		act(() => {
			result.current.chatSession.setDraft("hello");
		});
		await act(async () => {
			result.current.sendMessage();
		});
		await waitFor(() => {
			expect(result.current.sidebarView.tactics?.lastLoaded).toEqual([
				{ id: "ghost", name: "ghost" },
			]);
		});

		const preventDefault = vi.fn();
		act(() => {
			result.current.handleComposerKeyDown({
				key: "Enter",
				shiftKey: true,
				preventDefault,
			} as never);
			result.current.handleComposerKeyDown({
				key: "Enter",
				shiftKey: false,
				preventDefault,
			} as never);
		});
		expect(preventDefault).toHaveBeenCalledTimes(1);
		act(() => {
			result.current.confirmLastUserMessageEdit();
		});

		await act(async () => {
			result.current.confirmDeleteConversation();
		});
		await waitFor(() => {
			expect(result.current.chatSession.activeConversationId).toBeNull();
		});
		expect(result.current.chatSession.activeConversationId).toBeNull();
		expect(deleteConversation).toHaveBeenCalled();
	});

	it("uses display fallbacks for sparse provider and tactic data", async () => {
		const sparseConfigResponse = {
			...configResponse,
			config: {
				...config,
				providers: {
					local: {
						baseUrl: "http://provider.test",
						api: "openai-completions",
						models: [],
					},
				},
			},
		};
		const noKeywordTactic = { ...tactic, keywords: [] };
		queueMock(vi.mocked(loadConfig), sparseConfigResponse);
		queueMock(vi.mocked(listConversations), [conversation]);
		queueMock(vi.mocked(getConversation), {
			conversation,
			clock,
			timelineItems: [],
		});
		queueMock(
			vi.mocked(fetchTacticsStatus),
			{
				conversationId: "c1",
				tactics: [noKeywordTactic],
				stateDefinitions: [stateDefinition],
				userState: [],
				clock: null,
				recentRuns: [],
			},
			{
				tactics: [noKeywordTactic],
				stateDefinitions: [stateDefinition],
				userState: [],
				clock: null,
				recentRuns: [],
			},
		);

		const { result } = renderHook(() => useChatPage());

		await waitFor(() => {
			expect(result.current.config.config?.model).toBe("model-a");
		});
		await act(async () => {
			result.current.restoreConversation("c1");
		});
		await waitFor(() => {
			expect(result.current.sidebarView.tactics?.allowed).toEqual([
				{ id: "calm", name: "Calm" },
			]);
		});
		await act(async () => {
			await result.current.config.openConfigModal();
		});

		expect(result.current.configModalView.activeModelLabel).toBe(
			"Active model",
		);
		expect(result.current.configModalView.providers).toEqual([
			{
				id: "local",
				name: "local",
				baseUrl: "http://provider.test",
				modelsLabel: "No models configured",
				active: true,
			},
		]);
		expect(result.current.configModalView.tactics).toEqual([
			{ id: "calm", name: "Calm", keywordsLabel: "No trigger keywords" },
		]);
	});
});
