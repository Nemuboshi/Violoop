// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	StateDefinition,
	Tactic,
	VioloopConfig,
} from "../../src/shared/types";
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
	createLocalConversation,
	ensureLocalSeed,
	getLocalConfigResponse,
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
		expect(sent.createdItems[0]).toMatchObject({ content: "Local answer" });
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
});
