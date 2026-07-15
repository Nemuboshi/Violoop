// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalConversation } from "../../src/web/features/chat-session/api/createLocalConversation";
import {
	deleteLocal,
	resetMemoryDatabase,
} from "../../src/web/shared/storage/database";
import {
	ensureLocalSeed,
	getLocalConfig,
	getLocalConversationPayload,
	removeLocalState,
	removeLocalTactic,
	saveLocalConfig,
	saveLocalState,
	saveLocalTactic,
} from "../../src/web/shared/storage/localData";
import {
	clearAllLocalData,
	getConfig,
	getSessionTacticIdsLocal,
	listStateDefinitionsLocal,
	listTacticsLocal,
	markLocalSeedComplete,
	saveConfig,
	saveTacticLocal,
} from "../../src/web/shared/storage/repository";
import {
	localSeedConfig as config,
	stubLocalSeedFetch,
} from "./localStorageHelpers";

beforeEach(async () => {
	await clearAllLocalData();
	resetMemoryDatabase();
	stubLocalSeedFetch();
});

afterEach(() => {
	vi.unstubAllGlobals();
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
		await expect(getLocalConfig()).rejects.toThrow("unavailable");
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
		expect(await getLocalConfig()).toMatchObject({
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
