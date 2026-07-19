// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalConversation } from "../../src/web/features/chat-session/api/createLocalConversation";
import {
	editLocalLastUserMessage,
	sendLocalChatMessage,
} from "../../src/web/features/chat-session/api/localChat";
import {
	clearLocal,
	deleteLocal,
	getLocal,
	listLocal,
	putLocal,
	resetMemoryDatabase,
} from "../../src/web/shared/storage/database";
import {
	exportLocalData,
	parseImport,
	serializeExport,
} from "../../src/web/shared/storage/export";
import { importLocalData } from "../../src/web/shared/storage/import";
import {
	ensureLocalSeed,
	getLocalConfig,
	getLocalConversationPayload,
	getLocalTacticsStatus,
	removeLocalConversation,
	saveLocalConfig,
	saveLocalState,
	saveLocalTactic,
} from "../../src/web/shared/storage/localData";
import {
	clearAllLocalData,
	getConfig,
	getSessionUserStateLocal,
	listCompactionsLocal,
	saveStateDefinitionLocal,
} from "../../src/web/shared/storage/repository";
import {
	localSeedConfig as config,
	localSeedState as state,
	stubLocalSeedFetch,
	localSeedTactic as tactic,
} from "./localStorageHelpers";

beforeEach(async () => {
	await clearAllLocalData();
	resetMemoryDatabase();
	stubLocalSeedFetch();
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
		expect(await getLocalConfig()).toMatchObject({
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
		expect(data.providers.local).toMatchObject({ apiKey: "secret" });
		const parsedExport = parseImport(serializeExport(data));
		expect(parsedExport.providers.local).toMatchObject({ apiKey: "secret" });
		await clearAllLocalData();
		await importLocalData(parsedExport);
		expect(await getConfig()).toMatchObject({
			chat: { defaultProvider: "local" },
			providers: { local: { apiKey: "secret" } },
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
