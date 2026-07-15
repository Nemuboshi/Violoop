// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VioloopConfig } from "../../src/shared/types";
import { sendLocalChatMessage } from "../../src/web/features/chat-session/api/localChat";
import * as localRuntime from "../../src/web/features/chat-session/api/localRuntime";
import { runDailyStateUpdateLocal } from "../../src/web/features/chat-session/api/localRuntime";
import {
	deleteLocal,
	listLocal,
	openVioloopDatabase,
	putLocal,
	resetMemoryDatabase,
} from "../../src/web/shared/storage/database";
import {
	createLocalConversation,
	getLocalConfigResponse,
	getLocalConversationPayload,
} from "../../src/web/shared/storage/localData";
import {
	appendLocalItemsAtomic,
	clearAllLocalData,
	markLocalSeedComplete,
	saveConfig,
	saveStateDefinitionLocal,
} from "../../src/web/shared/storage/repository";
import { workerApp } from "../../src/worker/app";

const config: VioloopConfig = {
	chat: {
		defaultProvider: "local",
		defaultModel: "model-a",
		systemPrompt: "System",
		compaction: { enabled: false, triggerTokens: 1000, keepRecentTokens: 100 },
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

const allStores = [
	"meta",
	"config",
	"conversations",
	"timelineItems",
	"compactions",
	"sessionClocks",
	"sessionTactics",
	"sessionStates",
	"tactics",
	"stateDefinitions",
	"tacticRuns",
	"usage",
] as const;

function keyPathFor(store: string) {
	if (store === "config" || store === "meta") return "id";
	if (["sessionClocks", "sessionTactics", "sessionStates"].includes(store))
		return "conversationId";
	if (store === "usage") return "requestId";
	return "id";
}

beforeEach(async () => {
	await clearAllLocalData();
	await saveConfig(config);
	await markLocalSeedComplete();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("remaining branch squeezes", () => {
	it("covers the last localChat / runtime / storage / worker branches", async () => {
		await saveStateDefinitionLocal({
			id: "mood",
			name: "Mood",
			defaultValue: 5,
		});

		// Provider missing → baseUrl/api/name fallbacks
		await saveConfig({
			...config,
			chat: { ...config.chat, defaultProvider: "ghost" },
			providers: {},
		});
		const ghost = await getLocalConfigResponse();
		expect(ghost.baseUrl).toBe("");
		expect(ghost.api).toBe("openai-completions");
		expect(ghost.providerName).toBe("ghost");
		await saveConfig(config);

		// Whitespace → normalizeText fallback
		const spaced = await createLocalConversation({
			title: "   ",
			profile: {
				assistantName: "  ",
				userRole: "  ",
				assistantRole: "  ",
			},
			capabilities: {
				tactics: false,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
		});
		expect(spaced.conversation.title).toBe("New chat");
		expect(spaced.conversation.profile.assistantName).toBe("Violoop");

		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					text: JSON.stringify({
						messages: [
							{ kind: "chat", content: "First" },
							{ kind: "chat", content: "Second" },
						],
						runtimeActions: [
							{ tool: "advance_day", arguments: { content: "" } },
							{
								tool: "update_session_state",
								arguments: {
									note: "",
									patches: [{ key: "mood", delta: 1 }],
								},
							},
						],
					}),
					usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
				}),
			),
		);

		const created = await createLocalConversation({
			title: "Branches",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: true,
				sessionState: true,
				sceneEvents: false,
			},
			allowedTacticIds: [],
			// omit enabledStateIds → || [] branch
		});

		const noTitle = await createLocalConversation({
			title: null as unknown as string,
			profile: null as unknown as {
				assistantName: string;
				userRole: string;
				assistantRole: string;
			},
			capabilities: {
				tactics: false,
				dayProgression: true,
				sessionState: false,
				sceneEvents: false,
			},
		});
		expect(noTitle.conversation.title).toBe("New chat");
		await deleteLocal("sessionClocks", noTitle.conversation.id);
		expect(
			(await getLocalConversationPayload(noTitle.conversation.id)).clock,
		).toBeNull();

		const dailySpy = vi
			.spyOn(localRuntime, "runDailyStateUpdateLocal")
			.mockResolvedValueOnce({
				applied: [],
				note: "",
				states: undefined,
				clock: {
					conversationId: created.conversation.id,
					day: 2,
					updatedAt: new Date().toISOString(),
				},
			});

		const multi = await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "two messages",
		});
		expect(
			multi.createdItems.filter((item) => item.kind === "chat"),
		).toHaveLength(3);
		expect(multi.createdItems.some((item) => item.content === "Day 2")).toBe(
			true,
		);
		expect(
			multi.createdItems.some(
				(item) => item.content === "Session state updated.",
			),
		).toBe(true);
		dailySpy.mockRestore();

		// Missing messages + plain text (no runtimeActions key)
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					text: JSON.stringify({ runtimeActions: [] }),
					usage: { promptTokens: 1 },
				}),
			),
		);
		await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "no-messages",
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					text: "plain text with no json object",
					usage: { promptTokens: 1 },
				}),
			),
		);
		await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "plain",
		});

		// Scenes without clock → nextClock == null metadata branch
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					text: JSON.stringify({
						messages: [{ kind: "chat", content: "Scene only" }],
						runtimeActions: [
							{ tool: "emit_scene", arguments: { content: "Fog" } },
						],
					}),
				}),
			),
		);
		const scenesOnly = await createLocalConversation({
			title: "Scenes",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: false,
				sessionState: false,
				sceneEvents: true,
			},
			allowedTacticIds: [],
			enabledStateIds: [],
		});
		await sendLocalChatMessage({
			conversationId: scenesOnly.conversation.id,
			message: "look",
		});

		// No stored session state → []
		const noState = await createLocalConversation({
			title: "No stored state",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: true,
				sessionState: false,
				sceneEvents: false,
			},
			allowedTacticIds: [],
			enabledStateIds: [],
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					text: JSON.stringify({ patches: [], stateNote: "" }),
				}),
			),
		);
		await runDailyStateUpdateLocal({
			conversation: {
				...noState.conversation,
				capabilities: {
					...noState.conversation.capabilities,
					sessionState: true,
				},
			},
			config,
			clock: {
				conversationId: noState.conversation.id,
				day: 11,
				updatedAt: new Date().toISOString(),
			},
			timeline: [],
			persist: false,
		});

		// Missing clock row while dayProgression is on
		await deleteLocal("sessionClocks", created.conversation.id);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					text: JSON.stringify({
						messages: [{ kind: "chat", content: "No clock" }],
					}),
				}),
			),
		);
		await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "clock-miss",
		});

		await deleteLocal("conversations", created.conversation.id);
		await appendLocalItemsAtomic(created.conversation, []);

		// Memory listLocal with and without values
		vi.stubGlobal("indexedDB", undefined);
		resetMemoryDatabase();
		expect(await listLocal("tactics")).toEqual([]);
		await putLocal("tactics", {
			id: "calm",
			name: "Calm",
			keywords: [],
			emotionRules: [],
			blockedKeywords: [],
			instruction: "x",
		});
		expect(await listLocal("tactics")).toHaveLength(1);
		vi.stubGlobal("indexedDB", (await import("fake-indexeddb")).indexedDB);

		// Schema upgrade when every store already exists
		vi.stubGlobal("indexedDB", new IDBFactory());
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open("violoop", 1);
			request.onupgradeneeded = () => {
				const database = request.result;
				for (const store of allStores) {
					database.createObjectStore(store, { keyPath: keyPathFor(store) });
				}
			};
			request.onsuccess = () => {
				request.result.close();
				resolve();
			};
			request.onerror = () => reject(request.error);
		});
		await openVioloopDatabase();

		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({ choices: [{ message: { content: "ok" } }] }),
			),
		);
		const draft = await workerApp.request("/api/providers/test", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://provider.example/v1",
					api: "openai-completions",
					apiKey: "k",
				},
				model: "model-a",
			}),
		});
		expect(draft.status).toBe(200);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("plain-upstream");
			}),
		);
		const plain = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://provider.example/v1",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(plain.status).toBe(500);
	}, 30_000);
});
