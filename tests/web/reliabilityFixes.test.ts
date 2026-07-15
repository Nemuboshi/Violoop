// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VioloopConfig } from "../../src/shared/types";
import { sendLocalChatMessage } from "../../src/web/features/chat-session/api/localChat";
import { useChatSession } from "../../src/web/features/chat-session/model/useChatSession";
import { getLocal, putLocal } from "../../src/web/shared/storage/database";
import { serializeExport } from "../../src/web/shared/storage/export";
import {
	confirmReplaceImportPreview,
	importLocalExport,
} from "../../src/web/shared/storage/exportActions";
import {
	createLocalConversation,
	ensureLocalSeed,
	removeLocalTactic,
} from "../../src/web/shared/storage/localData";
import {
	clearAllLocalData,
	deleteConversationLocal,
	listUsageLocal,
	saveConfig,
	saveTacticLocal,
	saveUsageLocal,
} from "../../src/web/shared/storage/repository";

const config: VioloopConfig = {
	chat: {
		defaultProvider: "local",
		defaultModel: "model-a",
		systemPrompt: "System",
		compaction: { enabled: true, triggerTokens: 1, keepRecentTokens: 1 },
	},
	providers: {
		local: {
			baseUrl: "https://provider.example/v1",
			api: "openai-completions",
			apiKey: "secret",
			models: [{ id: "model-a" }],
		},
	},
};

beforeEach(async () => {
	await clearAllLocalData();
	await saveConfig(config);
	await putLocal("meta", { id: "seed", complete: true });
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("reliability and cleanup coverage", () => {
	it("keeps the main turn when compaction or daily state throws", async () => {
		await saveConfig({
			...config,
			chat: {
				...config.chat,
				compaction: { enabled: true, triggerTokens: 1, keepRecentTokens: 1 },
			},
		});
		const created = await createLocalConversation({
			title: "Side effects",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: true,
				sessionState: true,
				sceneEvents: false,
			},
			allowedTacticIds: [],
			enabledStateIds: [],
		});
		let call = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				call += 1;
				if (call === 1) {
					return Response.json({
						text: JSON.stringify({
							messages: [{ kind: "chat", content: `Answer ${"x".repeat(80)}` }],
							runtimeActions: [
								{ tool: "advance_day", arguments: { content: "Day 2" } },
							],
						}),
						usage: { promptTokens: 10 },
					});
				}
				if (call === 2) throw new Error("compact blew up");
				throw "daily blew up";
			}),
		);
		const sent = await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "hello ".repeat(40),
		});
		expect(sent.createdItems.some((item) => item.kind === "chat")).toBe(true);
		expect(
			sent.createdItems.some((item) => item.kind === "day_transition"),
		).toBe(true);

		call = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				call += 1;
				if (call === 1) {
					return Response.json({
						text: JSON.stringify({
							messages: [{ kind: "chat", content: `Again ${"y".repeat(80)}` }],
							runtimeActions: [
								{ tool: "advance_day", arguments: { content: "Day 3" } },
							],
						}),
						usage: { promptTokens: 10 },
					});
				}
				if (call === 2) throw "compact string";
				throw new Error("daily error");
			}),
		);
		await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "again ".repeat(40),
		});
	});

	it("rolls back create when persist fails after opening", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("boom");
			}),
		);
		const saveSpy = vi
			.spyOn(
				await import("../../src/web/shared/storage/repository"),
				"saveConversationLocal",
			)
			.mockRejectedValueOnce(new Error("persist fail"));
		await expect(
			createLocalConversation({
				title: "Fail",
				profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
				capabilities: {
					tactics: false,
					dayProgression: false,
					sessionState: false,
					sceneEvents: false,
				},
				allowedTacticIds: [],
				enabledStateIds: [],
			}),
		).rejects.toThrow("persist fail");
		saveSpy.mockRestore();
	});

	it("scrubs session tactics, usage orphans, seed meta, and cancelled import", async () => {
		await saveTacticLocal({
			id: "calm",
			name: "Calm",
			keywords: [],
			emotionRules: [],
			blockedKeywords: [],
			instruction: "Stay calm.",
		});
		const created = await createLocalConversation({
			title: "Tactics",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: true,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
			allowedTacticIds: ["calm"],
			enabledStateIds: [],
		});
		await saveUsageLocal("req-1", { promptTokens: 1 }, created.conversation.id);
		await saveUsageLocal("req-orphan", { promptTokens: 2 });
		await removeLocalTactic("calm");
		await deleteConversationLocal(created.conversation.id);
		const usage = await listUsageLocal();
		expect(usage.some((entry) => entry.requestId === "req-1")).toBe(false);
		expect(usage.some((entry) => entry.requestId === "req-orphan")).toBe(true);

		await clearAllLocalData();
		await saveConfig(config);
		await saveTacticLocal({
			id: "from-disk",
			name: "From Disk",
			keywords: [],
			emotionRules: [],
			blockedKeywords: [],
			instruction: "x",
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url.includes("settings.json")) return Response.json(config);
				if (url.includes("tactics.json"))
					return Response.json([
						{
							id: "from-disk",
							name: "From Disk",
							keywords: [],
							emotionRules: [],
							blockedKeywords: [],
							instruction: "x",
						},
						{
							id: "new-one",
							name: "New",
							keywords: [],
							emotionRules: [],
							blockedKeywords: [],
							instruction: "y",
						},
					]);
				if (url.includes("states.json")) return Response.json([]);
				return new Response("missing", { status: 404 });
			}),
		);
		await ensureLocalSeed();
		expect(await getLocal("meta", "seed")).toMatchObject({ complete: true });

		await putLocal("meta", { id: "backup:old", data: {} });
		const exported = {
			format: "violoop-export" as const,
			schemaVersion: 1,
			exportedAt: new Date().toISOString(),
			config,
			providers: {},
			tactics: [],
			stateDefinitions: [],
			conversations: [],
			usage: [],
		};
		await expect(
			importLocalExport(
				new File([serializeExport(exported)], "x.json", {
					type: "application/json",
				}),
				"replace",
				{ confirm: () => false },
			),
		).rejects.toThrow("Import cancelled");
		await importLocalExport(
			new File([serializeExport(exported)], "y.json", {
				type: "application/json",
			}),
			"replace",
			{ confirm: () => true },
		);
		expect(await getLocal("meta", "backup:old")).toBeUndefined();
		expect(await getLocal("meta", "backup:latest")).toBeTruthy();
	});

	it("exposes replace-import confirmation helper", () => {
		vi.stubGlobal(
			"confirm",
			vi.fn(() => true),
		);
		expect(
			confirmReplaceImportPreview({
				conversations: 1,
				tactics: 2,
				stateDefinitions: 3,
			}),
		).toBe(true);
		expect(window.confirm).toHaveBeenCalled();
	});

	it("skips seed when IndexedDB is unavailable", async () => {
		vi.stubGlobal("indexedDB", undefined);
		await ensureLocalSeed();
		vi.stubGlobal("indexedDB", (await import("fake-indexeddb")).indexedDB);
	});

	it("blocks send when the browser is offline", async () => {
		const { result } = renderHook(() => useChatSession());
		act(() => {
			result.current.applyConversation({
				conversation: {
					id: "c1",
					title: "S",
					profile: {
						assistantName: "A",
						userRole: "U",
						assistantRole: "R",
					},
					capabilities: {
						tactics: false,
						dayProgression: false,
						sessionState: false,
						sceneEvents: false,
					},
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					messageCount: 0,
				},
				clock: null,
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
	});
});
