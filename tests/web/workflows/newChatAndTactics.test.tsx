// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	deleteStateDefinition,
	deleteTactic,
	loadTacticsStatus,
	saveStateDefinition,
	saveTactic,
} from "../../../src/web/entities/tactic";
import { createLocalConversation } from "../../../src/web/features/chat-session/api/createLocalConversation";
import { useNewChatWorkflow } from "../../../src/web/features/new-chat";
import {
	toTacticEditorDraft,
	useTacticEditorWorkflow,
	useTacticsWorkflow,
} from "../../../src/web/features/tactic-management";
import {
	clock,
	conversation,
	queueMock,
	stateDefinition,
	tactic,
} from "./helpers";

vi.mock("../../../src/web/entities/tactic", () => ({
	deleteStateDefinition: vi.fn(),
	deleteTactic: vi.fn(),
	loadTacticsStatus: vi.fn(),
	saveStateDefinition: vi.fn(),
	saveTactic: vi.fn(),
}));

vi.mock(
	"../../../src/web/features/chat-session/api/createLocalConversation",
	() => ({
		createLocalConversation: vi.fn(),
	}),
);

beforeEach(() => {
	vi.mocked(createLocalConversation).mockReset();
	vi.mocked(loadTacticsStatus).mockReset();
	vi.mocked(saveTactic).mockReset();
	vi.mocked(deleteTactic).mockReset();
	vi.mocked(saveStateDefinition).mockReset();
	vi.mocked(deleteStateDefinition).mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("web business workflows: new chat and tactics", () => {
	it("starts a new chat with locked tactics and reports creation failures", async () => {
		const created = {
			conversation,
			clock,
			timelineItems: [],
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
			vi.mocked(loadTacticsStatus),
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
});
