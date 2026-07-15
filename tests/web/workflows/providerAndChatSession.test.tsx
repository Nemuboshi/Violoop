// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConversation } from "../../../src/web/entities/conversation";
import { useChatSession } from "../../../src/web/features/chat-session";
import {
	editLocalLastUserMessage as editLastUserMessage,
	sendLocalChatMessage as sendChatMessage,
} from "../../../src/web/features/chat-session/api/localChat";
import {
	newProviderEditorDraft,
	toProviderEditorDraft,
	useProviderWorkflow,
} from "../../../src/web/features/provider-management";
import {
	assistantMessage,
	clock,
	config,
	configResponse,
	conversation,
	jsonResponse,
	mockFetch,
	queueMock,
} from "./helpers";

vi.mock("../../../src/web/entities/conversation", () => ({
	deleteConversation: vi.fn(),
	getConversation: vi.fn(),
	listConversations: vi.fn(),
	renameConversation: vi.fn(),
}));

vi.mock("../../../src/web/features/chat-session/api/localChat", () => ({
	editLocalLastUserMessage: vi.fn(),
	sendLocalChatMessage: vi.fn(),
}));

beforeEach(() => {
	vi.mocked(getConversation).mockReset();
	vi.mocked(sendChatMessage).mockReset();
	vi.mocked(editLastUserMessage).mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("web business workflows: providers and chat session", () => {
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
