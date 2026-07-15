// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VioloopConfig } from "../../src/shared/types";
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
import { useChatSession } from "../../src/web/features/chat-session";
import {
	editLastUserMessage,
	sendChatMessage,
} from "../../src/web/features/chat-session/api/chatApi";
import { createLocalConversation } from "../../src/web/features/chat-session/api/createLocalConversation";
import { useConfigSettingsWorkflow } from "../../src/web/features/config-settings";
import {
	loadConfig,
	saveConfig,
} from "../../src/web/features/config-settings/api/configApi";
import { useConversationWorkflow } from "../../src/web/features/conversation-management";
import { useNewChatWorkflow } from "../../src/web/features/new-chat";
import {
	newProviderEditorDraft,
	toProviderEditorDraft,
	useProviderWorkflow,
} from "../../src/web/features/provider-management";
import {
	toTacticEditorDraft,
	useTacticEditorWorkflow,
	useTacticsWorkflow,
} from "../../src/web/features/tactic-management";

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

vi.mock(
	"../../src/web/features/chat-session/api/createLocalConversation",
	() => ({
		createLocalConversation: vi.fn(),
	}),
);

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
	return new Response(JSON.stringify(payload), {
		status: init.status ?? 200,
		headers: { "Content-Type": "application/json" },
	});
}

function mockFetch(...responses: Array<Response | (() => Response)>) {
	const fetchMock = vi.fn(async () => {
		const next = responses.shift();
		if (!next) {
			throw new Error("Unexpected fetch call");
		}
		return typeof next === "function" ? next() : next;
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

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
	assistantName: "Violoop",
	userRole: "User",
	assistantRole: "Assistant",
};

const conversation = {
	id: "c1",
	title: "Session",
	profile,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	messageCount: 2,
};

const clock = {
	conversationId: "c1",
	day: 1,
	updatedAt: "2026-01-01T00:00:00.000Z",
};

const assistantMessage = {
	id: "a1",
	conversationId: "c1",
	kind: "chat",
	role: "assistant",
	speakerName: "Violoop",
	content: "Hello",
	promptVisibility: "visible",
	createdAt: "2026-01-01T00:00:00.000Z",
	usage: { promptTokens: 10, cachedPromptTokens: 5, completionTokens: 4 },
};

const config: VioloopConfig = {
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
		backup: {
			name: "Backup",
			baseUrl: "http://backup.test",
			api: "openai-completions",
			models: [{ id: "model-b" }],
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
	cache: {
		systemPrompt: true,
		usageInStreaming: true,
	},
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

beforeEach(() => {
	vi.mocked(createLocalConversation).mockReset();
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
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("web business workflows", () => {
	it("loads and saves global chat settings through the config workflow", async () => {
		queueMock(vi.mocked(loadConfig), configResponse, configResponse);
		queueMock(vi.mocked(saveConfig), { config }, () => {
			throw new Error("Save failed");
		});
		const refreshTacticLibrary = vi.fn(async () => []);
		const { result } = renderHook(() =>
			useConfigSettingsWorkflow({ refreshTacticLibrary }),
		);

		await act(async () => {
			await result.current.saveSettingsDraft();
		});
		expect(result.current.error).toBe("");

		await act(async () => {
			await result.current.refreshConfig();
		});
		expect(result.current.draft?.defaultModel).toBe("model-a");

		await act(async () => {
			await result.current.openConfigModal();
		});
		expect(result.current.open).toBe(true);
		expect(refreshTacticLibrary).toHaveBeenCalled();

		const settingsDraft = result.current.draft;
		expect(settingsDraft).not.toBeNull();
		if (!settingsDraft) {
			throw new Error("Expected config draft to be loaded.");
		}

		await act(async () => {
			result.current.setDraft({
				...settingsDraft,
				temperature: "0.5",
			});
		});
		await act(async () => {
			await result.current.saveSettingsDraft();
		});
		expect(result.current.error).toBe("");

		await act(async () => {
			await result.current.saveSettingsDraft();
		});
		expect(result.current.error).toBe("Save failed");
	});

	it("keeps conversation deletion bounded and resets the active session only when needed", async () => {
		queueMock(vi.mocked(listConversations), [conversation]);
		queueMock(vi.mocked(deleteConversation), [], [], () => {
			throw new Error("Cannot delete");
		});
		const onError = vi.fn();
		const onDeletedActive = vi.fn();
		const { result } = renderHook(() =>
			useConversationWorkflow({ onError, onDeletedActive }),
		);

		await act(async () => {
			await result.current.confirmDeleteConversation("c1");
		});
		expect(onError).not.toHaveBeenCalled();

		await act(async () => {
			await result.current.refreshConversations();
		});
		expect(result.current.conversations).toHaveLength(1);

		await act(async () => {
			result.current.setConversationToDelete(conversation);
		});
		await act(async () => {
			await result.current.confirmDeleteConversation("c1");
		});
		expect(onDeletedActive).toHaveBeenCalled();
		expect(result.current.conversationToDelete).toBeNull();

		await act(async () => {
			result.current.setConversationToDelete(conversation);
		});
		await act(async () => {
			await result.current.confirmDeleteConversation("other");
		});
		expect(onDeletedActive).toHaveBeenCalledTimes(1);

		await act(async () => {
			result.current.setConversationToDelete(conversation);
		});
		await act(async () => {
			await result.current.confirmDeleteConversation("other");
		});
		expect(onError).toHaveBeenLastCalledWith("Cannot delete");
	});

	it("uses fallback messages when conversation deletion fails outside the normal API envelope", async () => {
		queueMock(vi.mocked(deleteConversation), () => {
			throw "offline";
		});
		const onError = vi.fn();
		const onDeletedActive = vi.fn();
		const { result } = renderHook(() =>
			useConversationWorkflow({ onError, onDeletedActive }),
		);

		act(() => {
			result.current.setConversationToDelete(conversation);
		});
		await act(async () => {
			await result.current.confirmDeleteConversation("other");
		});
		expect(onDeletedActive).not.toHaveBeenCalled();
		expect(onError).toHaveBeenLastCalledWith("Unable to delete conversation.");
	});

	it("starts a new chat with locked tactics and reports creation failures", async () => {
		const created = {
			conversation,
			clock,
			timelineItems: [assistantMessage],
		};
		queueMock(vi.mocked(createLocalConversation), created, () => {
			throw new Error("Create failed");
		});
		const onConversationCreated = vi.fn();
		const onRefreshConversations = vi.fn(async () => {});
		const onRefreshTactics = vi.fn(async () => {});
		const { result } = renderHook(() =>
			useNewChatWorkflow({
				createConversation: createLocalConversation,
				refreshTacticLibraryStatus: vi.fn(async () => ({
					tactics: [tactic],
					stateDefinitions: [stateDefinition],
					userState: [],
					clock: null,
					recentRuns: [],
				})),
				onConversationCreated,
				onRefreshConversations,
				onRefreshTactics,
			}),
		);

		await act(async () => {
			await result.current.openNewChatModal();
		});
		expect(result.current.open).toBe(true);
		expect(result.current.selectedTacticIds).toEqual(["calm"]);
		expect(result.current.selectedStateIds).toEqual(["urgency"]);

		await act(async () => {
			result.current.setTacticAllowed("calm", false);
			result.current.setTacticAllowed("brief", true);
			result.current.setDraft({
				title: "Custom session",
				assistantName: " Ava ",
				userRole: " ",
				assistantRole: "Guide",
				tactics: false,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			});
		});
		await act(async () => {
			await result.current.startNewConversation();
		});
		expect(onConversationCreated).toHaveBeenCalledWith(created);
		expect(onRefreshConversations).toHaveBeenCalled();
		expect(onRefreshTactics).toHaveBeenCalledWith("c1");
		expect(result.current.open).toBe(false);
		expect(createLocalConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				capabilities: {
					tactics: false,
					dayProgression: false,
					sessionState: false,
					sceneEvents: false,
				},
				allowedTacticIds: [],
				enabledStateIds: [],
			}),
		);

		await act(async () => {
			await result.current.startNewConversation();
		});
		expect(result.current.error).toBe("Create failed");
	});

	it("renames conversations explicitly and reports rename failures", async () => {
		queueMock(
			vi.mocked(renameConversation),
			[{ ...conversation, title: "Renamed" }],
			() => {
				throw new Error("Rename failed");
			},
			() => {
				throw "offline";
			},
		);
		const onError = vi.fn();
		const { result } = renderHook(() =>
			useConversationWorkflow({ onError, onDeletedActive: vi.fn() }),
		);

		await act(async () => {
			await result.current.confirmRenameConversation();
		});
		expect(onError).not.toHaveBeenCalled();

		act(() => {
			result.current.requestRenameConversation(conversation);
		});
		expect(result.current.conversationToRename?.id).toBe("c1");
		expect(result.current.renameTitle).toBe("Session");

		act(() => {
			result.current.setRenameTitle("Renamed");
		});
		await act(async () => {
			await result.current.confirmRenameConversation();
		});
		expect(result.current.conversations).toEqual([
			{ ...conversation, title: "Renamed" },
		]);
		expect(result.current.conversationToRename).toBeNull();

		act(() => {
			result.current.requestRenameConversation(conversation);
			result.current.setRenameTitle("Broken");
		});
		await act(async () => {
			await result.current.confirmRenameConversation();
		});
		expect(onError).toHaveBeenLastCalledWith("Rename failed");

		act(() => {
			result.current.requestRenameConversation(conversation);
			result.current.setRenameTitle("Offline");
		});
		await act(async () => {
			await result.current.confirmRenameConversation();
		});
		expect(onError).toHaveBeenLastCalledWith("Unable to rename conversation.");
	});

	it("keeps new-chat state recoverable when creation fails without an Error object", async () => {
		queueMock(vi.mocked(createLocalConversation), () => {
			throw "offline";
		});
		const { result } = renderHook(() =>
			useNewChatWorkflow({
				createConversation: createLocalConversation,
				refreshTacticLibraryStatus: vi.fn(async () => ({
					tactics: [],
					stateDefinitions: [],
					userState: [],
					clock: null,
					recentRuns: [],
				})),
				onConversationCreated: vi.fn(),
				onRefreshConversations: vi.fn(async () => {}),
				onRefreshTactics: vi.fn(async () => {}),
			}),
		);

		await act(async () => {
			await result.current.startNewConversation();
		});
		expect(result.current.error).toBe("Unable to start chat.");
		expect(result.current.saving).toBe(false);
	});

	it("auto-enables session state when selected tactics depend on states", async () => {
		const created = {
			conversation,
			clock: null,
			timelineItems: [],
		};
		queueMock(vi.mocked(createLocalConversation), created);
		const onConversationCreated = vi.fn();
		const { result } = renderHook(() =>
			useNewChatWorkflow({
				createConversation: createLocalConversation,
				refreshTacticLibraryStatus: vi.fn(async () => ({
					tactics: [{ ...tactic, requiredStateIds: ["urgency"] }],
					stateDefinitions: [stateDefinition],
					userState: [],
					clock: null,
					recentRuns: [],
				})),
				onConversationCreated,
				onRefreshConversations: vi.fn(async () => {}),
				onRefreshTactics: vi.fn(async () => {}),
			}),
		);

		await act(async () => {
			await result.current.openNewChatModal();
		});
		act(() => {
			result.current.setTacticAllowed("calm", false);
		});
		act(() => {
			result.current.setStateEnabled("urgency", false);
		});
		expect(result.current.selectedStateIds).toEqual([]);
		act(() => {
			result.current.setTacticAllowed("calm", true);
		});
		expect(result.current.selectedStateIds).toEqual(["urgency"]);
		expect(result.current.draft.sessionState).toBe(true);
		act(() => {
			result.current.setStateEnabled("urgency", false);
		});
		expect(result.current.selectedStateIds).toEqual(["urgency"]);
		expect(result.current.draft.sessionState).toBe(true);
		act(() => {
			result.current.setStateEnabled("urgency", true);
			result.current.setStateEnabled("urgency", false);
		});
		await act(async () => {
			await result.current.startNewConversation();
		});

		expect(result.current.error).toBe("");
		expect(onConversationCreated).toHaveBeenCalledWith(created);
		expect(createLocalConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				capabilities: expect.objectContaining({ sessionState: true }),
				enabledStateIds: ["urgency"],
			}),
		);
	});

	it("allows ordinary state toggles when no selected tactic requires them", async () => {
		const { result } = renderHook(() =>
			useNewChatWorkflow({
				createConversation: createLocalConversation,
				refreshTacticLibraryStatus: vi.fn(async () => ({
					tactics: [{ ...tactic, requiredStateIds: [] }],
					stateDefinitions: [stateDefinition],
					userState: [],
					clock: null,
					recentRuns: [],
				})),
				onConversationCreated: vi.fn(),
				onRefreshConversations: vi.fn(async () => {}),
				onRefreshTactics: vi.fn(async () => {}),
			}),
		);

		await act(async () => {
			await result.current.openNewChatModal();
		});
		act(() => {
			result.current.setTacticAllowed("calm", false);
			result.current.setTacticAllowed("calm", true);
			result.current.setStateEnabled("urgency", false);
		});

		expect(result.current.selectedTacticIds).toEqual(["calm"]);
		expect(result.current.selectedStateIds).toEqual([]);
	});

	it("opens a new chat with empty choices when tactic library status is unavailable", async () => {
		const { result } = renderHook(() =>
			useNewChatWorkflow({
				createConversation: createLocalConversation,
				refreshTacticLibraryStatus: vi.fn(async () => null),
				onConversationCreated: vi.fn(),
				onRefreshConversations: vi.fn(async () => {}),
				onRefreshTactics: vi.fn(async () => {}),
			}),
		);

		await act(async () => {
			await result.current.openNewChatModal();
		});

		expect(result.current.open).toBe(true);
		expect(result.current.selectedTacticIds).toEqual([]);
		expect(result.current.selectedStateIds).toEqual([]);
	});

	it("starts a state-enabled chat with selected session states", async () => {
		const created = {
			conversation,
			clock: null,
			timelineItems: [],
		};
		queueMock(vi.mocked(createLocalConversation), created);
		const { result } = renderHook(() =>
			useNewChatWorkflow({
				createConversation: createLocalConversation,
				refreshTacticLibraryStatus: vi.fn(async () => ({
					tactics: [],
					stateDefinitions: [stateDefinition],
					userState: [],
					clock: null,
					recentRuns: [],
				})),
				onConversationCreated: vi.fn(),
				onRefreshConversations: vi.fn(async () => {}),
				onRefreshTactics: vi.fn(async () => {}),
			}),
		);

		await act(async () => {
			await result.current.openNewChatModal();
		});
		act(() => {
			result.current.setDraft({
				...result.current.draft,
				sessionState: true,
			});
		});
		await act(async () => {
			await result.current.startNewConversation();
		});

		expect(createLocalConversation).toHaveBeenCalledWith(
			expect.objectContaining({
				capabilities: expect.objectContaining({ sessionState: true }),
				enabledStateIds: ["urgency"],
			}),
		);
	});

	it("refreshes tactic library and session status from global and session scopes", async () => {
		const onClockChange = vi.fn();
		queueMock(
			vi.mocked(fetchTacticsStatus),
			{
				conversationId: "c1",
				tactics: [
					tactic,
					{ ...tactic, id: "blocked", allowedInSession: false },
				],
				stateDefinitions: [stateDefinition],
				userState: [
					{
						key: "urgency",
						value: 60,
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
			null,
			null,
			null,
		);
		const { result } = renderHook(() => useTacticsWorkflow({ onClockChange }));

		await act(async () => {
			await result.current.refreshSessionStatus("c1");
		});
		expect(result.current.selectedTacticIds).toEqual(["calm"]);
		expect(onClockChange).toHaveBeenCalledWith(clock);

		await act(async () => {
			await result.current.refreshLibrary();
		});
		expect(result.current.libraryTactics).toEqual([tactic]);

		await act(async () => {
			await result.current.refreshSessionStatus(null);
		});
		expect(result.current.tacticsStatus).toBeNull();

		await act(async () => {
			await result.current.refreshSessionStatus("missing");
		});
		expect(result.current.selectedTacticIds).toEqual([]);

		await act(async () => {
			await result.current.refreshLibrary();
		});
		expect(result.current.libraryTactics).toEqual([]);

		await act(async () => {
			await result.current.refreshLibraryStatus();
		});
		expect(result.current.stateDefinitions).toEqual([]);
	});

	it("edits tactic library and refreshes active session state after mutations", async () => {
		queueMock(
			vi.mocked(saveTactic),
			{ tactics: [tactic], stateDefinitions: [stateDefinition] },
			() => {
				throw new Error("Save tactic failed");
			},
		);
		queueMock(
			vi.mocked(deleteTactic),
			{ tactics: [], stateDefinitions: [stateDefinition] },
			() => {
				throw new Error("Delete failed");
			},
		);
		queueMock(
			vi.mocked(saveStateDefinition),
			{ tactics: [], stateDefinitions: [stateDefinition] },
			() => {
				throw new Error("Save state failed");
			},
		);
		queueMock(
			vi.mocked(deleteStateDefinition),
			{ tactics: [], stateDefinitions: [] },
			() => {
				throw new Error("Delete state failed");
			},
		);
		const refreshTacticLibrary = vi.fn(async () => {});
		const refreshSessionTactics = vi.fn(async () => {});
		const setConfigError = vi.fn();
		const { result } = renderHook(() =>
			useTacticEditorWorkflow({
				activeConversationId: "c1",
				refreshTacticLibrary,
				refreshSessionTactics,
				setConfigError,
			}),
		);

		act(() => {
			result.current.openNewTacticEditor();
		});
		expect(result.current.tacticDraft?.name).toBe("New tactic");

		act(() => {
			result.current.openTacticEditor(tactic);
		});
		expect(result.current.tacticDraft?.originalId).toBe("calm");

		const editedTactic = result.current.tacticDraft;
		expect(editedTactic).not.toBeNull();
		if (!editedTactic) {
			throw new Error("Expected tactic draft to be open.");
		}

		await act(async () => {
			await result.current.saveTacticDraft(editedTactic);
		});
		expect(refreshTacticLibrary).toHaveBeenCalled();
		expect(refreshSessionTactics).toHaveBeenCalledWith("c1");
		expect(result.current.tacticDraft).toBeNull();

		await act(async () => {
			await result.current.saveTacticDraft(toTacticEditorDraft(tactic));
		});
		expect(setConfigError).toHaveBeenLastCalledWith("Save tactic failed");

		await act(async () => {
			await result.current.deleteTactic("calm");
		});
		expect(setConfigError).toHaveBeenLastCalledWith("");

		await act(async () => {
			await result.current.deleteTactic("calm");
		});
		expect(setConfigError).toHaveBeenLastCalledWith("Delete failed");

		await act(async () => {
			await result.current.saveStateDefinitionDraft(stateDefinition, null);
		});
		expect(refreshTacticLibrary).toHaveBeenCalled();
		expect(setConfigError).toHaveBeenLastCalledWith("");

		await act(async () => {
			await result.current.saveStateDefinitionDraft(stateDefinition, "urgency");
		});
		expect(setConfigError).toHaveBeenLastCalledWith("Save state failed");

		await act(async () => {
			await result.current.deleteStateDefinition("urgency");
		});
		expect(setConfigError).toHaveBeenLastCalledWith("");

		await act(async () => {
			await result.current.deleteStateDefinition("urgency");
		});
		expect(setConfigError).toHaveBeenLastCalledWith("Delete state failed");
	});

	it("refreshes only the global tactic library when no session is active and reports unknown tactic failures", async () => {
		queueMock(
			vi.mocked(saveTactic),
			{ tactics: [tactic], stateDefinitions: [stateDefinition] },
			() => {
				throw "save offline";
			},
		);
		queueMock(vi.mocked(deleteTactic), () => {
			throw "delete offline";
		});
		queueMock(vi.mocked(saveStateDefinition), () => {
			throw "state save offline";
		});
		queueMock(vi.mocked(deleteStateDefinition), () => {
			throw "state delete offline";
		});
		const refreshTacticLibrary = vi.fn(async () => {});
		const refreshSessionTactics = vi.fn(async () => {});
		const setConfigError = vi.fn();
		const { result } = renderHook(() =>
			useTacticEditorWorkflow({
				activeConversationId: null,
				refreshTacticLibrary,
				refreshSessionTactics,
				setConfigError,
			}),
		);

		await act(async () => {
			await result.current.saveTacticDraft(toTacticEditorDraft(tactic));
		});
		expect(refreshTacticLibrary).toHaveBeenCalled();
		expect(refreshSessionTactics).not.toHaveBeenCalled();

		await act(async () => {
			await result.current.saveTacticDraft(toTacticEditorDraft(tactic));
		});
		expect(setConfigError).toHaveBeenLastCalledWith("Unable to update tactic.");

		await act(async () => {
			await result.current.deleteTactic("calm");
		});
		expect(setConfigError).toHaveBeenLastCalledWith("Unable to delete tactic.");

		await act(async () => {
			await result.current.saveStateDefinitionDraft(stateDefinition, null);
		});
		expect(setConfigError).toHaveBeenLastCalledWith("Unable to update state.");

		await act(async () => {
			await result.current.deleteStateDefinition("urgency");
		});
		expect(setConfigError).toHaveBeenLastCalledWith("Unable to delete state.");
	});

	it("manages providers globally without binding them to a session", async () => {
		const saveAppConfig = vi.fn(async () => {});
		const setConfigError = vi.fn();
		const setConfigSaving = vi.fn();
		const { result, rerender } = renderHook(
			({ currentConfig }) =>
				useProviderWorkflow({
					config: currentConfig,
					saveAppConfig,
					setConfigError,
					setConfigSaving,
				}),
			{ initialProps: { currentConfig: configResponse } },
		);

		act(() => {
			result.current.openProviderEditor("local");
		});
		expect(result.current.providerDraft?.originalId).toBe("local");

		act(() => {
			result.current.closeProviderEditor();
			result.current.openNewProviderEditor();
		});
		expect(result.current.providerDraft?.originalId).toBeNull();

		await act(async () => {
			await result.current.saveProviderDraft({
				...newProviderEditorDraft(),
				originalId: "",
				name: "Backup",
				baseUrl: "http://new.test",
				models: "model-c",
			});
		});
		expect(setConfigError).toHaveBeenLastCalledWith(
			"Provider name is required.",
		);

		await act(async () => {
			await result.current.saveProviderDraft({
				...newProviderEditorDraft(),
				name: "Backup",
				baseUrl: "http://new.test",
				models: "model-c",
			});
		});
		expect(setConfigError).toHaveBeenLastCalledWith(
			'Provider "backup" already exists.',
		);

		await act(async () => {
			await result.current.saveProviderDraft({
				...newProviderEditorDraft(),
				name: "Fresh Provider",
				baseUrl: "http://fresh.test",
				models: "model-f",
			});
		});
		expect(saveAppConfig).toHaveBeenLastCalledWith(
			expect.objectContaining({
				providers: expect.objectContaining({
					"fresh-provider": expect.objectContaining({
						baseUrl: "http://fresh.test",
					}),
				}),
			}),
		);

		await act(async () => {
			await result.current.saveProviderDraft({
				...toProviderEditorDraft("local", config.providers.local),
				models: "model-z",
			});
		});
		expect(saveAppConfig).toHaveBeenLastCalledWith(
			expect.objectContaining({
				chat: expect.objectContaining({ defaultModel: "model-z" }),
			}),
		);

		await act(async () => {
			await result.current.deleteProvider("local");
		});
		expect(setConfigError).toHaveBeenLastCalledWith(
			"Active provider cannot be deleted.",
		);

		await act(async () => {
			await result.current.deleteProvider("backup");
		});
		expect(saveAppConfig).toHaveBeenLastCalledWith(
			expect.objectContaining({
				providers: expect.not.objectContaining({ backup: expect.anything() }),
			}),
		);

		await act(async () => {
			await result.current.activateProvider("backup");
		});
		expect(saveAppConfig).toHaveBeenLastCalledWith(
			expect.objectContaining({
				chat: expect.objectContaining({
					defaultProvider: "backup",
					defaultModel: "model-b",
				}),
			}),
		);

		rerender({ currentConfig: null });
		await act(async () => {
			result.current.openProviderEditor("local");
			await result.current.saveProviderDraft(newProviderEditorDraft());
			await result.current.deleteProvider("local");
			await result.current.activateProvider("local");
		});
		expect(result.current.providerDraft).toBeNull();

		const failingSave = vi.fn(async () => {
			throw new Error("Save unavailable");
		});
		const failing = renderHook(() =>
			useProviderWorkflow({
				config: configResponse,
				saveAppConfig: failingSave,
				setConfigError,
				setConfigSaving,
			}),
		);
		await act(async () => {
			await failing.result.current.saveProviderDraft({
				...toProviderEditorDraft("local", config.providers.local),
				models: "model-a",
			});
		});
		expect(setConfigError).toHaveBeenLastCalledWith("Save unavailable");
		await act(async () => {
			await failing.result.current.activateProvider("missing");
		});
		expect(failingSave).toHaveBeenCalledTimes(1);
		await act(async () => {
			await failing.result.current.activateProvider("backup");
		});
		expect(setConfigError).toHaveBeenLastCalledWith("Save unavailable");
	});

	it("keeps provider management usable when active providers have no model list or persistence fails oddly", async () => {
		const emptyModelConfig = {
			...configResponse,
			config: {
				...config,
				providers: {
					...config.providers,
					empty: {
						name: "Empty",
						baseUrl: "http://empty.test",
						api: "openai-completions" as const,
						models: [],
					},
				},
			},
		};
		const saveAppConfig = vi.fn(async () => {});
		const setConfigError = vi.fn();
		const setConfigSaving = vi.fn();
		const { result } = renderHook(() =>
			useProviderWorkflow({
				config: emptyModelConfig,
				saveAppConfig,
				setConfigError,
				setConfigSaving,
			}),
		);

		await act(async () => {
			await result.current.activateProvider("empty");
		});
		expect(saveAppConfig).toHaveBeenLastCalledWith(
			expect.objectContaining({
				chat: expect.objectContaining({
					defaultProvider: "empty",
					defaultModel: "model-a",
				}),
			}),
		);

		const unknownFailure = renderHook(() =>
			useProviderWorkflow({
				config: emptyModelConfig,
				saveAppConfig: vi.fn(async () => {
					throw "offline";
				}),
				setConfigError,
				setConfigSaving,
			}),
		);
		await act(async () => {
			await unknownFailure.result.current.saveProviderDraft(
				toProviderEditorDraft("local", config.providers.local),
			);
		});
		expect(setConfigError).toHaveBeenLastCalledWith("Unable to save provider.");
		await act(async () => {
			await unknownFailure.result.current.deleteProvider("backup");
		});
		expect(setConfigError).toHaveBeenLastCalledWith(
			"Unable to delete provider.",
		);
		await act(async () => {
			await unknownFailure.result.current.activateProvider("backup");
		});
		expect(setConfigError).toHaveBeenLastCalledWith(
			"Unable to switch provider.",
		);
	});

	it("tests provider drafts and keeps result popover closed until a result exists", async () => {
		mockFetch(
			jsonResponse({ ok: true, provider: "local", model: "model-a" }),
			jsonResponse({
				ok: true,
				provider: "local",
				model: "model-a",
				text: "pong",
			}),
			jsonResponse({ detail: "Provider unavailable" }, { status: 503 }),
			() => {
				throw "offline";
			},
		);
		const { result } = renderHook(() =>
			useProviderWorkflow({
				config: configResponse,
				saveAppConfig: vi.fn(async () => {}),
				setConfigError: vi.fn(),
				setConfigSaving: vi.fn(),
			}),
		);

		await act(async () => {
			await result.current.testProviderDraft({
				...newProviderEditorDraft(),
				baseUrl: "http://provider.test",
				models: "model-a",
			});
		});
		expect(result.current.providerTestResult).toMatchObject({
			status: "success",
			detail: "model-a",
		});

		await act(async () => {
			await result.current.testProviderDraft({
				...newProviderEditorDraft(),
				baseUrl: "http://provider.test",
				models: "model-a",
			});
		});
		expect(result.current.providerTestResult).toMatchObject({
			status: "success",
			detail: "model-a / pong",
		});
		expect(result.current.providerTestOpen).toBe(true);

		act(() => {
			result.current.setProviderTestOpen(false);
		});
		await act(async () => {
			await result.current.testProviderDraft({
				...newProviderEditorDraft(),
				baseUrl: "http://provider.test",
				models: "model-a",
			});
		});
		expect(result.current.providerTestResult).toMatchObject({
			status: "error",
			detail: "Provider unavailable",
		});

		await act(async () => {
			await result.current.testProviderDraft({
				...newProviderEditorDraft(),
				baseUrl: " ",
				models: "",
			});
		});
		expect(result.current.providerTestResult).toMatchObject({
			status: "error",
			title: "Provider test failed",
		});

		await act(async () => {
			await result.current.testProviderDraft({
				...newProviderEditorDraft(),
				baseUrl: "http://provider.test",
				models: "model-a",
			});
		});
		expect(result.current.providerTestResult).toMatchObject({
			status: "error",
			detail: "Provider test failed.",
		});
	});

	it("reports unknown config-save failures without leaving the settings workflow saving", async () => {
		queueMock(vi.mocked(loadConfig), configResponse);
		queueMock(vi.mocked(saveConfig), () => {
			throw "offline";
		});
		const { result } = renderHook(() =>
			useConfigSettingsWorkflow({
				refreshTacticLibrary: vi.fn(async () => []),
			}),
		);

		await act(async () => {
			await result.current.refreshConfig();
		});
		await act(async () => {
			await result.current.saveSettingsDraft();
		});
		expect(result.current.error).toBe("Unable to save config.");
		expect(result.current.saving).toBe(false);
	});

	it("restores, sends, refreshes, and resets a chat session", async () => {
		const restored = {
			conversation,
			clock,
			timelineItems: [assistantMessage],
		};
		const advancedClock = { ...clock, day: 2 };
		queueMock(
			vi.mocked(sendChatMessage),
			{
				requestId: "minimal",
				conversationId: "",
				tacticIds: undefined,
				clock: undefined,
				timelineItems: undefined,
				createdItems: [],
			},
			{
				requestId: "day-without-id",
				conversationId: "",
				tacticIds: [],
				clock,
				timelineItems: [],
				createdItems: [{ ...assistantMessage, kind: "day_transition" }],
			},
			{
				requestId: "r1",
				conversationId: "c1",
				tacticIds: ["calm"],
				usage: { promptTokens: 20 },
				clock: advancedClock,
				timelineItems: [
					assistantMessage,
					{
						...assistantMessage,
						id: "d2",
						kind: "day_transition",
						content: "Day 2",
					},
				],
				createdItems: [
					{ ...assistantMessage, id: "d2", kind: "day_transition" },
				],
			},
		);
		queueMock(vi.mocked(getConversation), restored);
		const onRefreshConversations = vi.fn(async () => {});
		const onRefreshTactics = vi.fn(async () => {});
		const { result } = renderHook(() => useChatSession());

		act(() => {
			result.current.applyConversation({
				conversation,
				clock,
				timelineItems: [],
			});
			result.current.setDraft("minimal");
		});
		await act(async () => {
			await result.current.sendMessage();
		});
		expect(result.current.activeConversationId).toBe("c1");

		act(() => {
			result.current.setDraft("advance");
		});
		await act(async () => {
			await result.current.sendMessage();
		});
		expect(result.current.lastTacticIds).toEqual([]);

		await act(async () => {
			await result.current.restoreConversation("c1", { onRefreshTactics });
		});
		expect(result.current.activeConversationId).toBe("c1");
		expect(result.current.lastUsage).toEqual(assistantMessage.usage);

		act(() => {
			result.current.setDraft(" hello ");
		});
		await act(async () => {
			await result.current.sendMessage({
				onRefreshConversations,
				onRefreshTactics,
			});
		});
		expect(result.current.lastTacticIds).toEqual(["calm"]);
		expect(result.current.activeClock?.day).toBe(2);
		expect(onRefreshConversations).toHaveBeenCalled();
		expect(result.current.messages.at(-1)?.content).toBe("Day 2");

		act(() => {
			result.current.resetSession();
		});
		expect(result.current.activeConversationId).toBeNull();
		expect(result.current.messages).toEqual([]);
	});

	it("keeps chat sending bounded when there is no valid draft or provider request fails", async () => {
		const { result } = renderHook(() => useChatSession());

		await act(async () => {
			await result.current.sendMessage();
		});
		expect(result.current.error).toBe("");

		act(() => {
			result.current.setDraft("hello");
		});
		await act(async () => {
			await result.current.sendMessage();
		});
		expect(result.current.error).toBe(
			"Start a new chat before sending a message.",
		);

		queueMock(vi.mocked(sendChatMessage), () => {
			throw new Error("Provider down");
		});
		act(() => {
			result.current.applyConversation({
				conversation,
				clock,
				timelineItems: [
					{
						...assistantMessage,
						id: "pending",
						content: "",
					},
				],
			});
			result.current.setDraft("hello");
		});
		await act(async () => {
			await result.current.sendMessage();
		});
		expect(result.current.status).toBe("error");
		expect(result.current.error).toBe("Provider down");
		expect(result.current.draft).toBe("hello");
		expect(result.current.messages).toEqual([
			expect.objectContaining({ id: "pending", content: "" }),
		]);
	});

	it("edits the last user message and regenerates the latest assistant turn", async () => {
		const userMessage = {
			...assistantMessage,
			id: "u1",
			role: "user",
			speakerName: "You",
			content: "Original question",
			usage: undefined,
		};
		const sceneMessage = {
			...assistantMessage,
			id: "s1",
			kind: "scene",
			role: "system",
			speakerName: "Scene",
			content: "Earlier scene",
			usage: undefined,
		};
		const regeneratedAssistant = {
			...assistantMessage,
			id: "a2",
			content: "Regenerated answer",
		};
		queueMock(vi.mocked(editLastUserMessage), {
			requestId: "edit",
			conversationId: "c1",
			tacticIds: ["calm"],
			usage: { promptTokens: 30 },
			clock,
			timelineItems: [
				{ ...userMessage, content: "Edited question" },
				regeneratedAssistant,
			],
			createdItems: [regeneratedAssistant],
		});
		const onRefreshConversations = vi.fn(async () => {});
		const onRefreshTactics = vi.fn(async () => {});
		const { result } = renderHook(() => useChatSession());

		act(() => {
			result.current.applyConversation({
				conversation,
				clock,
				timelineItems: [sceneMessage, userMessage, assistantMessage],
			});
		});
		expect(result.current.lastEditableUserMessageId).toBe("u1");

		act(() => {
			result.current.startEditingLastUserMessage("a1", "ignored");
		});
		expect(result.current.editingMessageId).toBeNull();

		act(() => {
			result.current.startEditingLastUserMessage("u1", "Original question");
			result.current.setEditingDraft("Edited question");
		});
		await act(async () => {
			await result.current.confirmLastUserMessageEdit({
				onRefreshConversations,
				onRefreshTactics,
			});
		});

		expect(editLastUserMessage).toHaveBeenCalledWith({
			conversationId: "c1",
			message: "Edited question",
		});
		expect(result.current.messages).toEqual([
			{ ...userMessage, content: "Edited question" },
			regeneratedAssistant,
		]);
		expect(result.current.lastTacticIds).toEqual(["calm"]);
		expect(result.current.status).toBe("idle");
		expect(onRefreshConversations).toHaveBeenCalled();
		expect(onRefreshTactics).toHaveBeenCalledWith("c1");
	});

	it("keeps edit recovery explicit when last-message regeneration fails", async () => {
		const userMessage = {
			...assistantMessage,
			id: "u1",
			role: "user",
			speakerName: "You",
			content: "Original question",
			usage: undefined,
		};
		queueMock(vi.mocked(editLastUserMessage), () => {
			throw new Error("Edit failed");
		});
		const { result } = renderHook(() => useChatSession());

		await act(async () => {
			await result.current.confirmLastUserMessageEdit();
		});
		expect(result.current.error).toBe("");

		act(() => {
			result.current.applyConversation({
				conversation,
				clock,
				timelineItems: [userMessage, assistantMessage],
			});
		});
		act(() => {
			result.current.startEditingLastUserMessage("u1", "Original question");
			result.current.setEditingDraft(" ");
		});
		await act(async () => {
			await result.current.confirmLastUserMessageEdit();
		});
		expect(result.current.error).toBe("A user message is required.");

		act(() => {
			result.current.setEditingDraft("Edited question");
		});
		await act(async () => {
			await result.current.confirmLastUserMessageEdit();
		});
		expect(result.current.status).toBe("error");
		expect(result.current.error).toBe("Edit failed");
		expect(result.current.messages).toEqual([userMessage, assistantMessage]);
		expect(result.current.editingMessageId).toBe("u1");
		expect(result.current.editingDraft).toBe("Edited question");
	});

	it("uses the generic edit failure message when regeneration fails oddly", async () => {
		const userMessage = {
			...assistantMessage,
			id: "u1",
			role: "user",
			speakerName: "You",
			content: "Original question",
			usage: undefined,
		};
		queueMock(vi.mocked(editLastUserMessage), () => {
			throw "offline";
		});
		const { result } = renderHook(() => useChatSession());

		act(() => {
			result.current.applyConversation({
				conversation,
				clock,
				timelineItems: [userMessage, assistantMessage],
			});
		});
		act(() => {
			result.current.startEditingLastUserMessage("u1", "Original question");
			result.current.setEditingDraft("Edited question");
		});
		await act(async () => {
			await result.current.confirmLastUserMessageEdit();
		});

		expect(result.current.error).toBe("Unable to reach the model provider.");
		expect(result.current.messages).toEqual([userMessage, assistantMessage]);
	});

	it("leaves the visible conversation intact when an unknown send failure has no pending assistant slot", async () => {
		queueMock(vi.mocked(sendChatMessage), () => {
			throw "offline";
		});
		const { result } = renderHook(() => useChatSession());

		act(() => {
			result.current.applyConversation({
				conversation,
				clock,
				timelineItems: [assistantMessage],
			});
			result.current.setDraft("hello");
		});
		await act(async () => {
			await result.current.sendMessage();
		});
		expect(result.current.error).toBe("Unable to reach the model provider.");
		expect(
			result.current.messages.some((message) => message.content === ""),
		).toBe(false);
	});

	it("keeps sending in the active chat when the chat response omits conversation id", async () => {
		queueMock(vi.mocked(sendChatMessage), {
			requestId: "same-chat",
			tacticIds: [],
			timelineItems: [assistantMessage],
			createdItems: [],
		});
		const { result } = renderHook(() => useChatSession());

		act(() => {
			result.current.applyConversation({
				conversation,
				clock,
				timelineItems: [],
			});
			result.current.setDraft("hello");
		});
		await act(async () => {
			await result.current.sendMessage();
		});
		expect(result.current.activeConversationId).toBe("c1");
		expect(result.current.messages).toEqual([assistantMessage]);
	});

	it("blocks sending while the browser reports itself offline", async () => {
		const { result } = renderHook(() => useChatSession());

		act(() => {
			result.current.applyConversation({
				conversation,
				clock,
				timelineItems: [],
			});
			result.current.setDraft("hello");
		});
		vi.stubGlobal("navigator", { onLine: false });
		await act(async () => {
			await result.current.sendMessage();
		});
		expect(result.current.error).toMatch(/offline/i);
		expect(result.current.draft).toBe("hello");
		expect(sendChatMessage).not.toHaveBeenCalled();
	});
});
