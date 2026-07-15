// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	StateDefinition,
	StoredCompaction,
	Tactic,
	TacticRunLogEntry,
	TimelineItem,
	VioloopConfig,
} from "../../src/shared/types";
import { createLocalConversation } from "../../src/web/features/chat-session/api/createLocalConversation";
import {
	editLocalLastUserMessage,
	sendLocalChatMessage,
} from "../../src/web/features/chat-session/api/localChat";
import { createClientId } from "../../src/web/shared/lib";
import {
	clearLocal,
	deleteLocal,
	getLocal,
	listLocal,
	openVioloopDatabase,
	putLocal,
	resetMemoryDatabase,
	runLocalTransaction,
} from "../../src/web/shared/storage/database";
import {
	exportLocalData,
	parseImport,
	serializeExport,
} from "../../src/web/shared/storage/export";
import { importLocalExport } from "../../src/web/shared/storage/exportActions";
import { importLocalData } from "../../src/web/shared/storage/import";
import {
	ensureLocalSeed,
	getLocalConfigResponse,
	getLocalConversationPayload,
	getLocalTacticsStatus,
	removeLocalConversation,
	removeLocalState,
	removeLocalTactic,
	saveLocalConfig,
	saveLocalState,
	saveLocalTactic,
} from "../../src/web/shared/storage/localData";
import {
	clearAllLocalData,
	deleteConversationLocal,
	getConfig,
	getSessionTacticIdsLocal,
	getUsageLocal,
	listCompactionsLocal,
	listConversationsLocal,
	listStateDefinitionsLocal,
	listTacticRunsLocal,
	listTacticsLocal,
	listTimelineItemsLocal,
	markLocalSeedComplete,
	replaceConversationTimelineLocal,
	saveCompactionLocal,
	saveConfig,
	saveConversationLocal,
	saveSessionTacticIdsLocal,
	saveStateDefinitionLocal,
	saveTacticLocal,
	saveTacticRunLocal,
	saveTimelineItemLocal,
	saveUsageLocal,
} from "../../src/web/shared/storage/repository";

const config: VioloopConfig = {
	chat: {
		defaultProvider: "local",
		defaultModel: "model-a",
		systemPrompt: "System",
		compaction: { enabled: true, triggerTokens: 1000, keepRecentTokens: 100 },
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
const tactic: Tactic = {
	id: "calm",
	name: "Calm",
	keywords: ["please"],
	emotionRules: [],
	blockedKeywords: [],
	instruction: "Stay calm.",
};
const state: StateDefinition = { id: "trust", name: "Trust", defaultValue: 50 };

beforeEach(async () => {
	await clearAllLocalData();
	resetMemoryDatabase();
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith("settings.json"))
				return new Response(JSON.stringify(config), { status: 200 });
			if (url.endsWith("tactics.json"))
				return new Response(JSON.stringify([tactic]), { status: 200 });
			if (url.endsWith("states.json"))
				return new Response(JSON.stringify([state]), { status: 200 });
			if (url.endsWith("/api/chat"))
				return new Response(
					JSON.stringify({
						text: JSON.stringify({
							messages: [{ kind: "chat", content: "Local answer" }],
						}),
						usage: { promptTokens: 2 },
					}),
					{ status: 200 },
				);
			return new Response("not found", { status: 404 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("IndexedDB local data", () => {
	it("seeds config and libraries, creates sessions, and restores them", async () => {
		await ensureLocalSeed();
		expect(await getConfig()).toMatchObject({
			providers: { local: { apiKey: "secret" } },
		});
		expect(await getLocalConfigResponse()).toMatchObject({
			provider: "local",
			model: "model-a",
		});
		const created = await createLocalConversation({
			title: " Local session ",
			profile: {
				assistantName: " Ava ",
				userRole: " User ",
				assistantRole: " Guide ",
			},
			capabilities: {
				tactics: true,
				dayProgression: true,
				sessionState: true,
				sceneEvents: false,
			},
			allowedTacticIds: ["calm"],
			enabledStateIds: [],
		});
		expect(created.conversation.title).toBe("Local session");
		expect(created.clock?.day).toBe(1);
		expect(
			(await getLocalConversationPayload(created.conversation.id))
				.timelineItems,
		).toHaveLength(1);
		expect(
			(await getLocalTacticsStatus(created.conversation.id)).tactics[0],
		).toMatchObject({ id: "calm", allowedInSession: true });
		await removeLocalConversation(created.conversation.id);
		await expect(
			getLocalConversationPayload(created.conversation.id),
		).rejects.toThrow("was not found");
	});

	it("rejects tactic state omissions and supports local mutations", async () => {
		await ensureLocalSeed();
		await saveLocalState({ ...state, id: "mood" }, null);
		await saveLocalTactic(
			{ ...tactic, emotionRules: [{ key: "mood", operator: ">=", value: 50 }] },
			"calm",
		);
		const autoEnabled = await createLocalConversation({
			title: "Auto-enabled state",
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
		expect(autoEnabled.conversation.capabilities.sessionState).toBe(true);
		expect(
			await getLocal("sessionStates", autoEnabled.conversation.id),
		).toMatchObject({
			states: expect.arrayContaining([
				expect.objectContaining({ key: "mood" }),
			]),
		});
		await expect(
			createLocalConversation({
				title: "Valid",
				profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
				capabilities: {
					tactics: true,
					dayProgression: false,
					sessionState: false,
					sceneEvents: false,
				},
				allowedTacticIds: ["calm"],
				enabledStateIds: ["mood"],
			}),
		).resolves.toBeTruthy();
		await saveLocalTactic({ ...tactic, id: "second" }, null);
		await expect(
			saveLocalTactic({ ...tactic, id: "second" }, null),
		).rejects.toThrow("already exists");
	});

	it("runs local chat turns, edits, exports, and imports data", async () => {
		await saveLocalConfig(config);
		const created = await createLocalConversation({
			title: "Chat",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
			allowedTacticIds: [],
			enabledStateIds: [],
		});
		const sent = await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "hello",
		});
		expect(
			sent.createdItems.some((item) => item.content === "Local answer"),
		).toBe(true);
		const edited = await editLocalLastUserMessage({
			conversationId: created.conversation.id,
			message: "edited",
		});
		expect(edited.timelineItems).toEqual(
			expect.arrayContaining([expect.objectContaining({ content: "edited" })]),
		);
		const data = await exportLocalData();
		expect(data.format).toBe("violoop-export");
		expect(data.providers.local).not.toHaveProperty("apiKey");
		expect(() => parseImport(serializeExport(data))).not.toThrow();
		await clearAllLocalData();
		await importLocalData(data);
		expect(await getConfig()).toMatchObject({
			chat: { defaultProvider: "local" },
		});
		expect((await listLocal("conversations")).length).toBe(1);
	});

	it("handles memory storage, export errors, and local chat failures", async () => {
		vi.stubGlobal("indexedDB", undefined);
		resetMemoryDatabase();
		await putLocal("meta", { id: "one", value: true });
		expect(await getLocal("meta", "one")).toMatchObject({ value: true });
		expect(await listLocal("meta")).toHaveLength(1);
		await deleteLocal("meta", "one");
		expect(await listLocal("meta")).toEqual([]);
		await clearLocal("meta");
		vi.stubGlobal("indexedDB", (await import("fake-indexeddb")).indexedDB);
		await saveLocalConfig(config);
		await expect(
			sendLocalChatMessage({ conversationId: "missing", message: "hello" }),
		).rejects.toThrow("was not found");
		expect(() => parseImport("bad json")).toThrow("valid JSON");
		expect(() => parseImport(JSON.stringify({ format: "wrong" }))).toThrow();
	});

	it("supports import conflict strategies and repository maintenance", async () => {
		await saveLocalConfig(config);
		const created = await createLocalConversation({
			title: "Import target",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
			allowedTacticIds: [],
			enabledStateIds: [],
		});
		const exported = await exportLocalData();
		const duplicate = structuredClone(exported);
		duplicate.conversations[0].conversation.title = "Imported title";
		await importLocalData(duplicate, { strategy: "keep-existing" });
		expect(
			(await getLocalConversationPayload(created.conversation.id)).conversation
				.title,
		).toBe("Import target");
		await importLocalData(duplicate, { strategy: "skip" });
		const skipped = await importLocalData(duplicate, { strategy: "replace" });
		expect(skipped.replaced).toBeGreaterThan(0);
		await expect(
			importLocalData({
				...exported,
				config: {
					...exported.config,
					chat: { ...exported.config.chat, defaultProvider: "missing" },
				},
			}),
		).rejects.toThrow("unknown default provider");
	});

	it("completes day transition, daily state, and compaction in the same turn", async () => {
		await saveStateDefinitionLocal({
			id: "trust",
			name: "Trust",
			defaultValue: 45,
		});
		await saveLocalConfig({
			...config,
			chat: {
				...config.chat,
				compaction: { enabled: true, triggerTokens: 1, keepRecentTokens: 1 },
			},
		});
		const created = await createLocalConversation({
			title: "Sync semantics",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: true,
				sessionState: true,
				sceneEvents: true,
			},
			allowedTacticIds: [],
			enabledStateIds: ["trust"],
		});

		let callIndex = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				callIndex += 1;
				// generateTurn awaits compaction before daily state.
				if (callIndex === 1) {
					return Response.json({
						text: JSON.stringify({
							messages: [{ kind: "chat", content: `Answer ${"x".repeat(80)}` }],
							runtimeActions: [
								{
									tool: "advance_day",
									arguments: { content: "Day 2", scene: "Rain" },
								},
							],
						}),
						usage: { promptTokens: 40, completionTokens: 5, totalTokens: 45 },
					});
				}
				if (callIndex === 2) {
					return Response.json({
						text: "Compacted summary of the conversation so far.",
					});
				}
				return Response.json({
					text: JSON.stringify({
						patches: [{ key: "trust", delta: 2 }],
						stateNote: "day state ready",
					}),
				});
			}),
		);

		const sent = await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "hello ".repeat(40),
		});

		expect(
			sent.createdItems.some((item) => item.kind === "day_transition"),
		).toBe(true);
		expect(sent.createdItems.some((item) => item.kind === "scene")).toBe(true);
		expect(
			sent.createdItems.some(
				(item) =>
					item.kind === "state_update" &&
					item.content.includes("day state ready"),
			),
		).toBe(true);

		const { listCompactionsLocal, getSessionUserStateLocal } = await import(
			"../../src/web/shared/storage/repository"
		);
		expect(
			await listCompactionsLocal(created.conversation.id),
		).not.toHaveLength(0);
		const states = await getSessionUserStateLocal(created.conversation.id);
		expect(
			states?.some((state) => state.key === "trust" && state.value !== 45),
		).toBe(true);
	});

	it("covers advanced local chat runtime paths", async () => {
		await saveStateDefinitionLocal({
			id: "trust",
			name: "Trust",
			defaultValue: 45,
		});
		await saveLocalConfig({
			...config,
			chat: {
				...config.chat,
				compaction: { enabled: false, triggerTokens: 1, keepRecentTokens: 1 },
			},
		});
		const created = await createLocalConversation({
			title: "Runtime",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: true,
				sessionState: true,
				sceneEvents: true,
			},
			allowedTacticIds: [],
			enabledStateIds: ["trust"],
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							text: JSON.stringify({
								messages: [{ kind: "chat", content: "Answer" }],
								runtimeActions: [
									{
										tool: "advance_day",
										arguments: { content: "Day 2", scene: "Rain" },
									},
									{
										tool: "update_session_state",
										arguments: {
											patches: [{ key: "trust", delta: 1 }],
											note: "warmer",
										},
									},
								],
							}),
							usage: { promptTokens: 2 },
						}),
						{ status: 200 },
					),
			),
		);
		const sent = await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "hello",
		});
		expect(
			sent.createdItems.some((item) => item.kind === "day_transition"),
		).toBe(true);
		await expect(
			sendLocalChatMessage({
				conversationId: created.conversation.id,
				message: "  ",
			}),
		).rejects.toThrow("required");
		await expect(
			editLocalLastUserMessage({
				conversationId: created.conversation.id,
				message: "   ",
			}),
		).rejects.toThrow("required");
	});
});

describe("local id generation", () => {
	it("falls back to a timestamp-based id when Web Crypto's randomUUID is unavailable", () => {
		vi.stubGlobal("crypto", {});
		const id = createClientId("widget");
		expect(id).toMatch(/^widget-[a-z0-9]+-[a-z0-9]+$/);
	});
});

type FakeIdbRequest = {
	result?: unknown;
	onsuccess?: () => void;
	onerror?: () => void;
	onupgradeneeded?: () => void;
	transaction?: {
		objectStore: (name: string) => { put: (value: unknown) => void };
	};
};
type FakeIdbTransaction = {
	objectStore: (name: string) => {
		get?: () => FakeIdbRequest;
		getAll?: () => FakeIdbRequest;
		put?: () => void;
		delete?: () => void;
		clear?: () => void;
	};
	oncomplete?: () => void;
	onerror?: () => void;
	onabort?: () => void;
};

function fakeIndexedDb(open: () => FakeIdbRequest & { result?: unknown }) {
	return { open } as unknown as IDBFactory;
}

describe("IndexedDB failure paths", () => {
	it("surfaces a failure to open the local database", async () => {
		vi.stubGlobal(
			"indexedDB",
			fakeIndexedDb(() => {
				const request: FakeIdbRequest = {};
				queueMicrotask(() => request.onerror?.());
				return request;
			}),
		);
		await expect(openVioloopDatabase()).rejects.toThrow(
			"Unable to open local database.",
		);
	});

	it("surfaces a failed read request", async () => {
		vi.stubGlobal(
			"indexedDB",
			fakeIndexedDb(() => {
				const opened: FakeIdbRequest = {
					result: {
						transaction(): FakeIdbTransaction {
							const tx: FakeIdbTransaction = {
								objectStore: () => ({
									get: () => {
										const req: FakeIdbRequest = {};
										queueMicrotask(() => req.onerror?.());
										return req;
									},
								}),
							};
							return tx;
						},
					},
				};
				queueMicrotask(() => opened.onsuccess?.());
				return opened;
			}),
		);
		await expect(getLocal("meta", "seed")).rejects.toThrow(
			"Local database request failed.",
		);
	});

	it("surfaces a read transaction failure even when no request error fires", async () => {
		vi.stubGlobal(
			"indexedDB",
			fakeIndexedDb(() => {
				const opened: FakeIdbRequest = {
					result: {
						transaction(): FakeIdbTransaction {
							const tx: FakeIdbTransaction = {
								objectStore: () => ({
									getAll: () => ({}),
								}),
							};
							queueMicrotask(() => tx.onerror?.());
							return tx;
						},
					},
				};
				queueMicrotask(() => opened.onsuccess?.());
				return opened;
			}),
		);
		await expect(listLocal("meta")).rejects.toThrow(
			"Local database transaction failed.",
		);
	});

	it("surfaces a failed write transaction", async () => {
		vi.stubGlobal(
			"indexedDB",
			fakeIndexedDb(() => {
				const opened: FakeIdbRequest = {
					result: {
						transaction(): FakeIdbTransaction {
							const tx: FakeIdbTransaction = {
								objectStore: () => ({
									put: () => {},
									delete: () => {},
									clear: () => {},
								}),
							};
							queueMicrotask(() => tx.onerror?.());
							return tx;
						},
					},
				};
				queueMicrotask(() => opened.onsuccess?.());
				return opened;
			}),
		);
		await expect(putLocal("meta", { id: "one", value: true })).rejects.toThrow(
			"Local database transaction failed.",
		);
	});

	it("skips creating object stores that already exist during a schema upgrade", async () => {
		const existingStores = new Set(["meta"]);
		vi.stubGlobal(
			"indexedDB",
			fakeIndexedDb(() => {
				const database = {
					objectStoreNames: {
						contains: (name: string) => existingStores.has(name),
					},
					createObjectStore: (name: string) => {
						existingStores.add(name);
					},
				};
				const request: FakeIdbRequest = {
					result: database,
					transaction: { objectStore: () => ({ put: () => {} }) },
				};
				queueMicrotask(() => {
					request.onupgradeneeded?.();
					request.onsuccess?.();
				});
				return request;
			}),
		);
		const database = await openVioloopDatabase();
		expect(existingStores.has("meta")).toBe(true);
		expect(existingStores.has("tactics")).toBe(true);
		expect(database).toBeTruthy();
	});

	it("resolves an empty list when a memory-mode store was never populated", async () => {
		vi.stubGlobal("indexedDB", undefined);
		resetMemoryDatabase();
		expect(await listLocal("tacticRuns")).toEqual([]);
	});

	it("rolls back an in-memory transaction when an operation throws and resolves missing keys to a default", async () => {
		vi.stubGlobal("indexedDB", undefined);
		resetMemoryDatabase();
		await putLocal("meta", { id: "keep", value: 1 });
		const poisoned = new Proxy(
			{},
			{
				has() {
					throw new Error("boom");
				},
			},
		);
		await expect(
			runLocalTransaction([
				{ type: "put", storeName: "meta", value: { id: "keep", value: 2 } },
				{ type: "put", storeName: "meta", value: poisoned },
			]),
		).rejects.toThrow("boom");
		expect(await getLocal("meta", "keep")).toMatchObject({ value: 1 });

		await putLocal("meta", {} as unknown as { id: string });
		expect(await getLocal("meta", "current")).toEqual({});

		await expect(runLocalTransaction([])).resolves.toBeUndefined();
	});
});

describe("repository primitives", () => {
	it("writes timeline items, compactions, and usage records directly and reads them back", async () => {
		await clearAllLocalData();
		const conversation = {
			id: "conv-1",
			title: "Direct",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			messageCount: 0,
		};
		await saveConversationLocal(conversation);
		const item: TimelineItem = {
			id: "item-1",
			conversationId: conversation.id,
			kind: "chat",
			role: "user",
			content: "hi",
			promptVisibility: "visible",
			createdAt: "2026-01-01T00:00:00.000Z",
		};
		await saveTimelineItemLocal(item);
		const compaction: StoredCompaction = {
			id: "compaction-1",
			conversationId: conversation.id,
			summary: "summary",
			coveredMessageIds: [item.id],
			tokenEstimate: 10,
			createdAt: "2026-01-01T00:00:00.000Z",
			model: "model-a",
		};
		await saveCompactionLocal(compaction);
		await saveUsageLocal("request-1", { promptTokens: 5 }, conversation.id);
		await saveUsageLocal("request-without-conversation", { promptTokens: 1 });
		expect(await getUsageLocal("request-without-conversation")).toMatchObject({
			promptTokens: 1,
		});
		await saveTacticRunLocal({
			id: "run-1",
			conversationId: conversation.id,
			messageId: null,
			tacticId: "calm",
			score: 1,
			loaded: true,
			decision: "loaded",
			reason: { reasons: [], matchedKeywords: [], contraindications: [] },
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(await getUsageLocal("request-1")).toMatchObject({
			promptTokens: 5,
		});
		expect(
			await replaceConversationTimelineLocal(conversation, [
				{ ...item, content: "replaced" },
			]),
		).toBeUndefined();

		await saveConversationLocal({ ...conversation, id: "conv-0" });
		await saveConversationLocal({
			...conversation,
			id: "conv-2",
			updatedAt: "2026-02-01T00:00:00.000Z",
		});
		const list = await listConversationsLocal();
		expect(list[0]?.id).toBe("conv-2");

		expect(await getSessionTacticIdsLocal("missing-conversation")).toEqual([]);
		await saveSessionTacticIdsLocal(conversation.id, ["calm"]);
		expect(await listTacticRunsLocal(conversation.id)).toHaveLength(1);
		await deleteConversationLocal(conversation.id);
		expect(await getSessionTacticIdsLocal(conversation.id)).toEqual([]);
		expect(await listTacticRunsLocal(conversation.id)).toEqual([]);
	});
});

describe("export and import data integrity", () => {
	it("exports an empty config placeholder and cancels a replace import that fails confirmation", async () => {
		await clearAllLocalData();
		const emptyExport = await exportLocalData();
		expect(emptyExport.config).toMatchObject({
			chat: { defaultProvider: "", defaultModel: "" },
		});

		await saveLocalConfig(config);
		const created = await createLocalConversation({
			title: "Confirm",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
			allowedTacticIds: [],
			enabledStateIds: [],
		});
		const exported = await exportLocalData();
		const file = new File([serializeExport(exported)], "violoop.json", {
			type: "application/json",
		});
		await expect(
			importLocalExport(file, "replace", { confirm: () => false }),
		).rejects.toThrow("cancelled");
		expect(
			(await getLocalConversationPayload(created.conversation.id)).conversation
				.title,
		).toBe("Confirm");

		const confirmed = await importLocalExport(file, "replace", {
			confirm: () => true,
		});
		expect(confirmed.replaced + confirmed.imported).toBeGreaterThan(0);

		await deleteLocal("meta", "backup:latest");
		const withoutBackup = await importLocalExport(file, "skip");
		expect(withoutBackup.strategy).toBe("skip");
		expect(await getLocal("meta", "backup:latest")).toBeUndefined();
	});

	it("merges keep-existing sub-records and replaces existing ones on subsequent imports", async () => {
		await saveConfig(config);
		await markLocalSeedComplete();
		await saveStateDefinitionLocal({
			id: "trust",
			name: "Trust",
			defaultValue: 45,
		});
		await saveLocalTactic(
			{
				id: "calm",
				name: "Calm",
				keywords: ["please"],
				emotionRules: [],
				blockedKeywords: [],
				instruction: "Stay calm.",
			},
			null,
		);
		const created = await createLocalConversation({
			title: "Merge target",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: true,
				dayProgression: true,
				sessionState: true,
				sceneEvents: true,
			},
			allowedTacticIds: ["calm"],
			enabledStateIds: ["trust"],
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							text: JSON.stringify({
								messages: [{ kind: "chat", content: "Answer" }],
								runtimeActions: [
									{
										tool: "advance_day",
										arguments: { content: "Day 2", scene: "Rain" },
									},
								],
							}),
						}),
						{ status: 200 },
					),
			),
		);
		await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "please help",
		});
		await saveCompactionLocal({
			id: "compaction-manual",
			conversationId: created.conversation.id,
			summary: "manual summary",
			coveredMessageIds: [],
			tokenEstimate: 5,
			createdAt: "2026-01-01T00:00:00.000Z",
			model: "model-a",
		});

		const baseline = await exportLocalData();
		const baselineEntry = baseline.conversations.find(
			(entry) => entry.conversation.id === created.conversation.id,
		);
		if (!baselineEntry) throw new Error("Expected exported conversation.");
		expect(baselineEntry.timelineItems.length).toBeGreaterThan(0);
		expect(baselineEntry.compactions.length).toBeGreaterThan(0);
		expect(baselineEntry.tacticRuns.length).toBeGreaterThan(0);
		expect(baselineEntry.clock).toBeTruthy();

		const withNewSubItems = structuredClone(baseline);
		const targetEntry = withNewSubItems.conversations.find(
			(entry) => entry.conversation.id === created.conversation.id,
		);
		if (!targetEntry) throw new Error("Expected exported conversation.");
		const extraItem: TimelineItem = {
			id: "extra-item",
			conversationId: created.conversation.id,
			kind: "chat",
			role: "system",
			content: "extra",
			promptVisibility: "hidden",
			createdAt: "2026-03-01T00:00:00.000Z",
		};
		const extraCompaction: StoredCompaction = {
			id: "extra-compaction",
			conversationId: created.conversation.id,
			summary: "extra summary",
			coveredMessageIds: [],
			tokenEstimate: 1,
			createdAt: "2026-03-01T00:00:00.000Z",
			model: "model-a",
		};
		const extraRun: TacticRunLogEntry = {
			id: "extra-run",
			conversationId: created.conversation.id,
			messageId: null,
			tacticId: "calm",
			score: 1,
			loaded: true,
			decision: "loaded",
			reason: { reasons: [], matchedKeywords: [], contraindications: [] },
			createdAt: "2026-03-01T00:00:00.000Z",
		};
		targetEntry.timelineItems.push(extraItem);
		targetEntry.compactions.push(extraCompaction);
		targetEntry.tacticRuns.push(extraRun);
		await importLocalData(withNewSubItems, { strategy: "keep-existing" });
		expect(
			(await listTimelineItemsLocal(created.conversation.id)).some(
				(item) => item.id === "extra-item",
			),
		).toBe(true);
		expect(
			(await listCompactionsLocal(created.conversation.id)).some(
				(item) => item.id === "extra-compaction",
			),
		).toBe(true);
		expect(
			(await listTacticRunsLocal(created.conversation.id)).some(
				(run) => run.id === "extra-run",
			),
		).toBe(true);

		const replaced = await importLocalData(baseline, { strategy: "replace" });
		expect(replaced.replaced).toBeGreaterThan(0);
		expect(
			(await listTimelineItemsLocal(created.conversation.id)).some(
				(item) => item.id === "extra-item",
			),
		).toBe(false);
	});

	it("rejects imports with invalid configuration objects and preserves current providers on keep-existing merges", async () => {
		await saveLocalConfig(config);
		const exported = await exportLocalData();
		await expect(
			importLocalData({
				...exported,
				config: null as unknown as typeof exported.config,
			}),
		).resolves.toMatchObject({ imported: expect.any(Number) });
		await expect(
			importLocalData({
				...exported,
				config: { totally: "wrong" } as unknown as typeof exported.config,
			}),
		).rejects.toThrow("invalid configuration");

		await expect(
			importLocalData(
				{
					...exported,
					config: {
						...config,
						providers: {
							...config.providers,
							extra: {
								baseUrl: "https://extra.example/v1",
								api: "openai-completions",
							},
						},
					},
				},
				{ strategy: "keep-existing" },
			),
		).resolves.toBeTruthy();
		expect(await getConfig()).toMatchObject({
			providers: {
				local: { apiKey: "secret" },
				extra: { api: "openai-completions" },
			},
		});

		const withoutUsage = structuredClone(exported);
		// @ts-expect-error usage is optional at runtime even though the export type always populates it.
		withoutUsage.usage = undefined;
		await expect(
			importLocalData(withoutUsage, { strategy: "skip" }),
		).resolves.toBeTruthy();
	});

	it("rejects cross-referenced imports with unknown tactic states or mismatched conversation ids", async () => {
		await saveLocalConfig(config);
		await saveStateDefinitionLocal({
			id: "trust",
			name: "Trust",
			defaultValue: 45,
		});
		const created = await createLocalConversation({
			title: "Cross reference",
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
		await saveCompactionLocal({
			id: "compaction-cross",
			conversationId: created.conversation.id,
			summary: "cross summary",
			coveredMessageIds: [],
			tokenEstimate: 1,
			createdAt: "2026-01-01T00:00:00.000Z",
			model: "model-a",
		});
		await saveSessionTacticIdsLocal(created.conversation.id, []);
		await saveTacticRunLocal({
			id: "run-cross",
			conversationId: created.conversation.id,
			messageId: null,
			tacticId: "calm",
			score: 1,
			loaded: true,
			decision: "loaded",
			reason: { reasons: [], matchedKeywords: [], contraindications: [] },
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		const baseline = await exportLocalData();

		const withValidTactic = structuredClone(baseline);
		withValidTactic.tactics.push({
			id: "calm",
			name: "Calm",
			keywords: [],
			emotionRules: [{ key: "trust", operator: ">=", value: 10 }],
			blockedKeywords: [],
			instruction: "Stay calm.",
		});
		await expect(
			importLocalData(withValidTactic, { strategy: "skip" }),
		).resolves.toBeTruthy();

		const withUnknownTacticState = structuredClone(baseline);
		withUnknownTacticState.tactics.push({
			id: "calm",
			name: "Calm",
			keywords: [],
			emotionRules: [{ key: "unknown-state", operator: ">=", value: 10 }],
			blockedKeywords: [],
			instruction: "Stay calm.",
		});
		await expect(
			importLocalData(withUnknownTacticState, { strategy: "skip" }),
		).rejects.toThrow("requires unknown states");

		const withBadClock = structuredClone(baseline);
		const clockEntry = withBadClock.conversations.find(
			(entry) => entry.conversation.id === created.conversation.id,
		);
		if (!clockEntry?.clock) throw new Error("Expected a session clock.");
		clockEntry.clock.conversationId = "different-conversation";
		await expect(
			importLocalData(withBadClock, { strategy: "skip" }),
		).rejects.toThrow("invalid clock");

		const withBadTimelineItem = structuredClone(baseline);
		const timelineEntry = withBadTimelineItem.conversations.find(
			(entry) => entry.conversation.id === created.conversation.id,
		);
		if (!timelineEntry) throw new Error("Expected a conversation entry.");
		timelineEntry.timelineItems.push({
			id: "stray-item",
			conversationId: "different-conversation",
			kind: "chat",
			role: "user",
			content: "stray",
			promptVisibility: "visible",
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		await expect(
			importLocalData(withBadTimelineItem, { strategy: "skip" }),
		).rejects.toThrow("invalid timeline item");

		const withBadCompaction = structuredClone(baseline);
		const compactionEntry = withBadCompaction.conversations.find(
			(entry) => entry.conversation.id === created.conversation.id,
		);
		if (!compactionEntry) throw new Error("Expected a conversation entry.");
		compactionEntry.compactions[0].conversationId = "different-conversation";
		await expect(
			importLocalData(withBadCompaction, { strategy: "skip" }),
		).rejects.toThrow("invalid compaction");

		const withBadTacticRun = structuredClone(baseline);
		const runEntry = withBadTacticRun.conversations.find(
			(entry) => entry.conversation.id === created.conversation.id,
		);
		if (!runEntry) throw new Error("Expected a conversation entry.");
		runEntry.tacticRuns[0].conversationId = "different-conversation";
		await expect(
			importLocalData(withBadTacticRun, { strategy: "skip" }),
		).rejects.toThrow("invalid tactic run");
	});
});

describe("local tactic and state mutation guards", () => {
	it("rejects tactic mutations that change ids or collide, and cleans up session references on removal", async () => {
		await saveConfig(config);
		await markLocalSeedComplete();
		await saveLocalTactic(
			{
				id: "calm",
				name: "Calm",
				keywords: ["please"],
				emotionRules: [],
				blockedKeywords: ["shout", "yell"],
				instruction: "Stay calm.",
			},
			null,
		);
		await expect(
			saveLocalTactic(
				{
					id: "renamed",
					name: "Calm",
					keywords: [],
					emotionRules: [],
					blockedKeywords: [],
					instruction: "Stay calm.",
				},
				"calm",
			),
		).rejects.toThrow("cannot change its id");
		await expect(
			saveLocalTactic(
				{
					id: "calm",
					name: "Second calm",
					keywords: [],
					emotionRules: [],
					blockedKeywords: [],
					instruction: "Stay calm.",
				},
				null,
			),
		).rejects.toThrow("already exists");

		const withTactic = await createLocalConversation({
			title: "Session tactic",
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
		expect(await getSessionTacticIdsLocal(withTactic.conversation.id)).toEqual([
			"calm",
		]);
		await removeLocalTactic("calm");
		expect(await getSessionTacticIdsLocal(withTactic.conversation.id)).toEqual(
			[],
		);
		await expect(removeLocalTactic("calm")).rejects.toThrow("was not found");

		await expect(
			saveLocalTactic(
				{
					id: "needs-unknown",
					name: "Needs unknown",
					keywords: [],
					emotionRules: [{ key: "unknown-state", operator: ">=", value: 1 }],
					blockedKeywords: [],
					instruction: "x",
				},
				null,
			),
		).rejects.toThrow("requires unknown states");
	});

	it("rejects state mutations that change ids, collide, or leave dangling tactic dependents", async () => {
		await saveConfig(config);
		await markLocalSeedComplete();
		await saveLocalState({ id: "mood", name: "Mood", defaultValue: 50 }, null);
		await expect(
			saveLocalState({ id: "renamed", name: "Mood", defaultValue: 50 }, "mood"),
		).rejects.toThrow("cannot change its id");
		await expect(
			saveLocalState(
				{ id: "mood", name: "Second mood", defaultValue: 10 },
				null,
			),
		).rejects.toThrow("already exists");

		await saveLocalTactic(
			{
				id: "needs-mood",
				name: "Needs mood",
				keywords: [],
				emotionRules: [{ key: "mood", operator: ">=", value: 10 }],
				blockedKeywords: [],
				instruction: "x",
			},
			null,
		);
		await expect(removeLocalState("mood")).rejects.toThrow(
			"is used by tactics",
		);
		await removeLocalTactic("needs-mood");
		await removeLocalState("mood");
		await expect(removeLocalState("mood")).rejects.toThrow("was not found");
	});
});

describe("local seed defaults and tactic selection defaults", () => {
	it("skips seeding entirely when IndexedDB is unavailable and requires config before returning a settings snapshot", async () => {
		vi.stubGlobal("indexedDB", undefined);
		resetMemoryDatabase();
		await expect(getLocalConfigResponse()).rejects.toThrow("unavailable");
	});

	it("keeps a pre-existing configuration when seeding runs before it is marked complete", async () => {
		await clearAllLocalData();
		await saveConfig({
			...config,
			chat: { ...config.chat, systemPrompt: "Custom already set" },
		});
		await ensureLocalSeed();
		expect(await getConfig()).toMatchObject({
			chat: { systemPrompt: "Custom already set" },
		});
	});

	it("falls back to empty provider details when the default provider is missing from the config", async () => {
		await saveConfig({
			...config,
			chat: { ...config.chat, defaultProvider: "missing" },
		});
		await markLocalSeedComplete();
		expect(await getLocalConfigResponse()).toMatchObject({
			baseUrl: "",
			api: "openai-completions",
		});
	});

	it("falls back to a null clock when day progression is enabled but no clock row exists", async () => {
		await saveLocalConfig(config);
		const created = await createLocalConversation({
			title: "Missing clock",
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
		await deleteLocal("sessionClocks", created.conversation.id);
		expect(
			(await getLocalConversationPayload(created.conversation.id)).clock,
		).toBeNull();
	});

	it("falls back to default titles and profile text when they are omitted or blank", async () => {
		await saveLocalConfig(config);
		const created = await createLocalConversation({
			profile: { assistantName: "  ", userRole: "  ", assistantRole: "  " },
			capabilities: {
				tactics: false,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
			allowedTacticIds: [],
			enabledStateIds: [],
		});
		expect(created.conversation.title).toBe("New chat");
		expect(created.conversation.profile.assistantName).toBe("Violoop");
	});

	it("seeds default tactics and states without clobbering ones that already exist", async () => {
		await clearAllLocalData();
		await saveTacticLocal({
			id: "calm",
			name: "Calm",
			keywords: ["please"],
			emotionRules: [],
			blockedKeywords: [],
			instruction: "Pre-existing instruction.",
		});
		await ensureLocalSeed();
		const tactics = await listTacticsLocal();
		expect(tactics.find((item) => item.id === "calm")).toMatchObject({
			instruction: "Pre-existing instruction.",
		});
		const states = await listStateDefinitionsLocal();
		expect(states.some((item) => item.id === "trust")).toBe(true);
	});

	it("selects every enabled tactic when no explicit allow-list is provided", async () => {
		await saveLocalConfig(config);
		await saveLocalTactic(
			{
				id: "always-on",
				name: "Always on",
				keywords: [],
				emotionRules: [],
				blockedKeywords: [],
				instruction: "x",
			},
			null,
		);
		const created = await createLocalConversation({
			title: "No allow-list",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: true,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
		});
		expect(await getSessionTacticIdsLocal(created.conversation.id)).toContain(
			"always-on",
		);
	});
});
