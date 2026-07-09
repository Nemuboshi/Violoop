import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VioloopConfig } from "../../src/shared/types";

let dataDir = "";

async function useTempDataDir() {
	dataDir = await mkdtemp(join(tmpdir(), "violoop-test-"));
	process.env.VIOLOOP_DATA_DIR = dataDir;
	vi.resetModules();
	return dataDir;
}

async function writeJson(name: string, value: unknown) {
	await writeFile(
		join(dataDir, name),
		`${JSON.stringify(value, null, 2)}\n`,
		"utf8",
	);
}

const defaultStateDefinitions = [
	{
		id: "urgency",
		name: "Urgency",
		description: "Need for a direct answer.",
		defaultValue: 40,
	},
	{
		id: "frustration",
		name: "Frustration",
		defaultValue: 20,
	},
	{
		id: "confidence-needed",
		name: "Confidence needed",
		defaultValue: 50,
	},
	{
		id: "detail-tolerance",
		name: "Detail tolerance",
		defaultValue: 50,
	},
];

function validConfig(): VioloopConfig {
	return {
		chat: {
			defaultProvider: "local",
			defaultModel: "model-a",
			systemPrompt: "System",
			temperature: 0.4,
			thinkingLevel: "high",
			cache: { systemPrompt: true },
			compaction: { enabled: true, triggerTokens: 1000, keepRecentTokens: 100 },
		},
		providers: {
			local: {
				name: "Local",
				baseUrl: "http://localhost/v1/",
				api: "openai-completions",
				authHeader: false,
				headers: { "x-test": "1" },
				models: [
					{
						id: "model-a",
						compat: {
							supportsDeveloperRole: true,
							thinkingFormat: "openrouter",
						},
					},
				],
				compat: { supportsUsageInStreaming: false, thinkingFormat: "openai" },
			},
		},
	};
}

beforeEach(async () => {
	await useTempDataDir();
	await writeJson("states.json", defaultStateDefinitions);
});

afterEach(async () => {
	vi.useRealTimers();
	delete process.env.VIOLOOP_DATA_DIR;
	await rm(dataDir, { recursive: true, force: true });
});

describe("json config store", () => {
	it("can be imported before a data directory override is present", async () => {
		delete process.env.VIOLOOP_DATA_DIR;
		vi.resetModules();
		await expect(import("../../src/server/config")).resolves.toBeTruthy();
		await expect(
			import("../../src/server/conversations"),
		).resolves.toBeTruthy();
		await expect(import("../../src/server/tactics")).resolves.toBeTruthy();
		await useTempDataDir();
	});

	it("requires explicit seeded settings before server startup", async () => {
		const { initializeConfigStore } = await import("../../src/server/config");
		await expect(initializeConfigStore()).rejects.toThrow(
			"Missing data/settings.json",
		);
	});

	it("loads, validates, saves, and resolves active provider settings", async () => {
		await writeJson("settings.json", validConfig());
		const {
			initializeConfigStore,
			loadConfig,
			resolveActiveProvider,
			saveConfig,
		} = await import("../../src/server/config");
		await expect(initializeConfigStore()).resolves.toBeUndefined();
		await expect(loadConfig()).resolves.toMatchObject({
			chat: { defaultModel: "model-a" },
		});
		const active = resolveActiveProvider(await loadConfig());
		expect(active).toMatchObject({
			id: "local",
			baseUrl: "http://localhost/v1",
			authHeader: false,
			headers: { "x-test": "1" },
			compat: {
				supportsUsageInStreaming: false,
				supportsDeveloperRole: true,
				thinkingFormat: "openrouter",
			},
		});

		const saved = await saveConfig({
			...validConfig(),
			chat: { ...validConfig().chat, thinkingLevel: "xhigh" },
		});
		expect(saved.chat.thinkingLevel).toBe("xhigh");
		await expect(
			readFile(join(dataDir, "settings.json"), "utf8"),
		).resolves.toContain('"thinkingLevel": "xhigh"');
	});

	it("rejects invalid provider references and unsafe compaction windows", async () => {
		await writeJson("settings.json", {
			...validConfig(),
			chat: { ...validConfig().chat, defaultProvider: "missing" },
		});
		const { loadConfig, saveConfig, resolveActiveProvider } = await import(
			"../../src/server/config"
		);
		await expect(loadConfig()).rejects.toThrow(/missing/);
		await expect(
			saveConfig({
				...validConfig(),
				chat: { ...validConfig().chat, defaultModel: "missing-model" },
			}),
		).rejects.toThrow("missing-model");
		await expect(
			saveConfig({
				...validConfig(),
				chat: {
					...validConfig().chat,
					compaction: {
						enabled: true,
						triggerTokens: 10,
						keepRecentTokens: 10,
					},
				},
			}),
		).rejects.toThrow("keepRecentTokens");
		expect(() =>
			resolveActiveProvider({
				...validConfig(),
				chat: { ...validConfig().chat, defaultProvider: "missing" },
			}),
		).toThrow('Provider "missing" is not configured.');
	});

	it("resolves minimal provider settings and rethrows non-missing settings read errors", async () => {
		const minimal = {
			...validConfig(),
			chat: {
				...validConfig().chat,
				defaultProvider: "minimal",
				defaultModel: "ad-hoc",
			},
			providers: {
				minimal: {
					baseUrl: "http://minimal.test/v1///",
					api: "openai-completions" as const,
				},
			},
		};
		await writeJson("settings.json", minimal);
		const { initializeConfigStore, loadConfig, resolveActiveProvider } =
			await import("../../src/server/config");
		await expect(loadConfig()).resolves.toMatchObject({
			chat: { defaultModel: "ad-hoc" },
		});
		expect(resolveActiveProvider(await loadConfig())).toMatchObject({
			id: "minimal",
			name: "minimal",
			baseUrl: "http://minimal.test/v1",
			authHeader: true,
			headers: {},
			model: { id: "ad-hoc", api: "openai-completions" },
			compat: {},
		});

		await useTempDataDir();
		await mkdir(join(dataDir, "settings.json"), { recursive: true });
		const configAgain = await import("../../src/server/config");
		await expect(configAgain.initializeConfigStore()).rejects.not.toThrow(
			"Missing data/settings.json",
		);
		await expect(initializeConfigStore()).resolves.toBeUndefined();
	});
});

describe("conversation event log", () => {
	it("replays conversations, prompt context, session state, and deletion from JSONL events", async () => {
		const conversations = await import("../../src/server/conversations");
		expect(await conversations.listConversations()).toEqual([]);

		const older = await conversations.createConversation({ title: "Older" });
		await conversations.appendTimelineItem({
			conversationId: older.id,
			kind: "chat",
			role: "assistant",
			content: "default visible",
		});
		expect(await conversations.listTimelineItems(older.id)).toMatchObject([
			{ promptVisibility: "visible" },
		]);
		await conversations.createConversation({ title: "Newer" });
		expect(await conversations.listConversations()).toHaveLength(2);

		const created = await conversations.createConversation({
			title: " ",
			profile: {
				assistantName: " Ava\nLoop ",
				userRole: " Player ",
				assistantRole: " Guide ",
			},
		});
		expect(created).toMatchObject({
			title: "New chat",
			profile: {
				assistantName: "Ava Loop",
				userRole: "Player",
				assistantRole: "Guide",
			},
			messageCount: 0,
		});

		const user = await conversations.appendTimelineItem({
			conversationId: created.id,
			kind: "chat",
			role: "user",
			content:
				"This is the first user message but it should not rename the chat.",
			promptVisibility: "visible",
		});
		const hidden = await conversations.appendTimelineItem({
			conversationId: created.id,
			kind: "state_update",
			role: "system",
			content: "Hidden state",
			promptVisibility: "hidden",
		});
		const kept = await conversations.appendTimelineItem({
			conversationId: created.id,
			kind: "chat",
			role: "assistant",
			content: "Visible answer",
			promptVisibility: "visible",
			usage: { promptTokens: 2 },
		});
		await conversations.appendCompaction({
			conversationId: created.id,
			summary: "Earlier summary",
			firstKeptMessageId: kept.id,
			coveredMessageIds: [user.id, hidden.id],
			tokenEstimate: 200,
			model: "model-a",
		});
		await conversations.setSessionClock({
			conversationId: created.id,
			day: 2,
			stateUpdatedDay: 1,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		await conversations.setSessionTacticIds(created.id, ["a", "b"]);
		await conversations.setSessionUserState(created.id, [
			{
				key: "urgency",
				value: 42,
				source: "observed",
				confidence: 0.8,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		await conversations.appendTacticRun({
			conversationId: created.id,
			messageId: user.id,
			tacticId: "a",
			score: 1,
			loaded: true,
			decision: "loaded",
			reason: {
				reasons: ["matched"],
				matchedKeywords: ["x"],
				contraindications: [],
			},
		});

		expect((await conversations.listConversations())[0]).toMatchObject({
			id: created.id,
			title: "New chat",
			messageCount: 2,
		});
		await expect(
			conversations.renameConversation(created.id, "Renamed session"),
		).resolves.toMatchObject({ title: "Renamed session" });
		expect((await conversations.listConversations())[0]).toMatchObject({
			id: created.id,
			title: "Renamed session",
		});
		expect(await conversations.listTimelineItems(created.id)).toHaveLength(3);
		expect(await conversations.loadPromptContext(created.id)).toMatchObject({
			summary: { summary: "Earlier summary" },
			messages: [{ id: kept.id, content: "Visible answer" }],
		});
		expect(await conversations.getSessionClock(created.id)).toMatchObject({
			day: 2,
			stateUpdatedDay: 1,
		});
		expect(await conversations.getSessionTacticIds(created.id)).toEqual([
			"a",
			"b",
		]);
		expect(await conversations.getSessionUserState(created.id)).toEqual([
			{
				key: "urgency",
				value: 42,
				source: "observed",
				confidence: 0.8,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		expect(
			await conversations.listRecentTacticRunsFromLog(created.id),
		).toMatchObject([{ tacticId: "a", loaded: true }]);

		await conversations.deleteConversation(created.id);
		expect(await conversations.getConversation(created.id)).toBeUndefined();
		expect(await conversations.listTimelineItems(created.id)).toEqual([]);
	});

	it("handles deleted conversations, migrated events, missing prompt anchors, and global tactic run history", async () => {
		const conversations = await import("../../src/server/conversations");
		await expect(conversations.deleteConversation("missing")).rejects.toThrow(
			'Conversation "missing" was not found.',
		);
		await expect(
			conversations.renameConversation("missing", "Nope"),
		).rejects.toThrow('Conversation "missing" was not found.');

		await writeFile(
			join(dataDir, "conversations.jsonl"),
			`${JSON.stringify({ type: "storage.migrated", eventId: "m", createdAt: "2026-01-01T00:00:00.000Z" })}\n${JSON.stringify(
				{
					type: "conversation.title_updated",
					eventId: "title-missing",
					conversationId: "missing",
					title: "Ignored",
					createdAt: "2026-01-01T00:00:01.000Z",
				},
			)}\n`,
			"utf8",
		);
		expect(await conversations.listConversations()).toEqual([]);
		expect(await conversations.loadPromptContext("missing")).toEqual({
			summary: undefined,
			messages: [],
		});

		const conversation = await conversations.createConversation({
			title: "New chat",
		});
		await conversations.appendTimelineItem({
			conversationId: conversation.id,
			kind: "chat",
			role: "user",
			content: "   ",
			promptVisibility: "visible",
		});
		expect(await conversations.getConversation(conversation.id)).toMatchObject({
			title: "New chat",
		});
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		await conversations.appendCompaction({
			conversationId: conversation.id,
			summary: "Summary",
			firstKeptMessageId: "missing-anchor",
			coveredMessageIds: [],
			tokenEstimate: 1,
			model: "model-a",
		});
		vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
		const afterCompaction = await conversations.appendTimelineItem({
			conversationId: conversation.id,
			kind: "chat",
			role: "assistant",
			content: "after compaction",
			promptVisibility: "visible",
		});
		vi.useRealTimers();
		const promptContext = await conversations.loadPromptContext(
			conversation.id,
		);
		expect(promptContext.summary).toMatchObject({ summary: "Summary" });
		expect(promptContext.messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: afterCompaction.id }),
			]),
		);
		await conversations.appendTacticRun({
			conversationId: null,
			messageId: null,
			tacticId: "global",
			score: 0,
			loaded: false,
			decision: "skipped",
			reason: {
				reasons: ["no trigger matched"],
				matchedKeywords: [],
				contraindications: [],
			},
		});
		expect(
			await conversations.listRecentTacticRunsFromLog(undefined, 1),
		).toMatchObject([{ tacticId: "global" }]);

		await conversations.appendCompaction({
			conversationId: "missing-conversation",
			summary: "orphan compaction",
			coveredMessageIds: [],
			tokenEstimate: 1,
			model: "model-a",
		});
		expect(await conversations.listConversations()).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "missing-conversation" }),
			]),
		);

		await conversations.deleteConversation(conversation.id);
		await conversations.appendTimelineItem({
			conversationId: conversation.id,
			kind: "chat",
			role: "user",
			content: "ignored after delete",
			promptVisibility: "visible",
		});
		expect(await conversations.listTimelineItems(conversation.id)).toEqual([]);
	});

	it("updates a timeline item and prunes later items without relying on timestamps", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		const conversations = await import("../../src/server/conversations");
		const conversation = await conversations.createConversation({
			title: "Editable chat",
		});
		const user = await conversations.appendTimelineItem({
			conversationId: conversation.id,
			kind: "chat",
			role: "user",
			content: "old prompt",
			promptVisibility: "visible",
		});
		await conversations.appendTimelineItem({
			conversationId: conversation.id,
			kind: "chat",
			role: "assistant",
			content: "old answer",
			promptVisibility: "visible",
		});
		await conversations.appendTimelineItem({
			conversationId: conversation.id,
			kind: "state_update",
			role: "system",
			content: "old state",
			promptVisibility: "hidden",
		});

		await conversations.updateTimelineItemContent({
			conversationId: conversation.id,
			itemId: user.id,
			content: "edited prompt",
		});
		await conversations.pruneTimelineItemsAfter({
			conversationId: conversation.id,
			itemId: user.id,
		});

		expect(
			await conversations.listTimelineItems(conversation.id),
		).toMatchObject([{ id: user.id, content: "edited prompt" }]);
		expect(
			await conversations.loadPromptContext(conversation.id),
		).toMatchObject({ messages: [{ id: user.id, content: "edited prompt" }] });
		expect(await conversations.listConversations()).toMatchObject([
			{ id: conversation.id, messageCount: 1 },
		]);
		await expect(
			conversations.updateTimelineItemContent({
				conversationId: conversation.id,
				itemId: "missing",
				content: "nope",
			}),
		).rejects.toThrow('Timeline item "missing" was not found.');
		await expect(
			conversations.updateTimelineItemContent({
				conversationId: "missing",
				itemId: user.id,
				content: "nope",
			}),
		).rejects.toThrow('Conversation "missing" was not found.');
		await expect(
			conversations.pruneTimelineItemsAfter({
				conversationId: conversation.id,
				itemId: "missing",
			}),
		).rejects.toThrow('Timeline item "missing" was not found.');
		const emptyConversation = await conversations.createConversation({
			title: "Empty timeline",
		});
		await expect(
			conversations.pruneTimelineItemsAfter({
				conversationId: emptyConversation.id,
				itemId: "missing",
			}),
		).rejects.toThrow('Timeline item "missing" was not found.');
		await expect(
			conversations.pruneTimelineItemsAfter({
				conversationId: "missing",
				itemId: user.id,
			}),
		).rejects.toThrow('Conversation "missing" was not found.');
		vi.useRealTimers();
	});

	it("ignores stale timeline replacement events when their target is absent", async () => {
		await writeFile(
			join(dataDir, "conversations.jsonl"),
			[
				{
					type: "conversation.created",
					eventId: "c",
					conversationId: "c1",
					title: "Stale edits",
					profile: {
						assistantName: "Violoop",
						userRole: "User",
						assistantRole: "Assistant",
					},
					createdAt: "2026-01-01T00:00:00.000Z",
				},
				{
					type: "timeline.item_updated",
					eventId: "u",
					conversationId: "c1",
					itemId: "missing",
					content: "ignored",
					createdAt: "2026-01-01T00:00:01.000Z",
				},
				{
					type: "timeline.items_pruned_after",
					eventId: "p",
					conversationId: "c1",
					itemId: "missing",
					createdAt: "2026-01-01T00:00:02.000Z",
				},
			]
				.map((event) => JSON.stringify(event))
				.join("\n"),
			"utf8",
		);
		const conversations = await import("../../src/server/conversations");
		expect(await conversations.listTimelineItems("c1")).toEqual([]);
		expect(await conversations.listConversations()).toMatchObject([
			{ id: "c1", messageCount: 0 },
		]);
	});

	it("reports malformed JSONL events with line numbers and missing created events", async () => {
		await writeFile(
			join(dataDir, "conversations.jsonl"),
			'{"type":"bad"}\n',
			"utf8",
		);
		const conversations = await import("../../src/server/conversations");
		await expect(conversations.listConversations()).rejects.toThrow(
			"Invalid conversation event at line 1",
		);

		await useTempDataDir();
		await writeFile(
			join(dataDir, "conversations.jsonl"),
			`${JSON.stringify({
				type: "timeline.item_created",
				eventId: "e",
				conversationId: "missing",
				itemId: "i",
				kind: "chat",
				role: "user",
				content: "hello",
				promptVisibility: "visible",
				createdAt: "2026-01-01T00:00:00.000Z",
			})}\n`,
			"utf8",
		);
		const conversationsAgain = await import("../../src/server/conversations");
		await expect(conversationsAgain.listConversations()).rejects.toThrow(
			'Conversation "missing" is missing its created event.',
		);

		await useTempDataDir();
		await writeFile(join(dataDir, "conversations.jsonl"), "{}\n", "utf8");
		const parse = vi.spyOn(JSON, "parse").mockImplementation(() => {
			throw "not an error";
		});
		const conversationsWithParseFailure = await import(
			"../../src/server/conversations"
		);
		await expect(
			conversationsWithParseFailure.listConversations(),
		).rejects.toThrow("unknown error");
		parse.mockRestore();
	});
});

describe("tactics business rules", () => {
	const tactic = (id: string, keywords: string[], value = 0) => ({
		id,
		name: id,
		keywords,
		emotionRules: value
			? [{ key: "urgency" as const, operator: ">=" as const, value }]
			: [],
		blockedKeywords: ["blocked"],
		instruction: `Use ${id}`,
	});

	it("creates an empty tactics file on startup and supports create, update, delete", async () => {
		const tactics = await import("../../src/server/tactics");
		await tactics.initializeTacticStore();
		await expect(tactics.initializeTacticStore()).resolves.toBeUndefined();
		expect(await tactics.listTacticsOverview()).toEqual([]);
		await tactics.createTactic(tactic("one", ["go"]));
		await expect(tactics.createTactic(tactic("one", ["go"]))).rejects.toThrow(
			'Tactic "one" already exists.',
		);
		expect(await tactics.listTacticsOverview()).toMatchObject([
			{ id: "one", allowedInSession: true },
		]);
		await tactics.updateTactic("one", {
			...tactic("ignored", ["next"]),
			instruction: " Updated ",
		});
		expect(await tactics.listTacticsOverview()).toMatchObject([
			{ id: "one", keywords: ["next"], instruction: "Updated" },
		]);
		await expect(
			tactics.updateTactic("missing", tactic("missing", [])),
		).rejects.toThrow('Tactic "missing" was not found.');
		await tactics.deleteTactic("one");
		await expect(tactics.deleteTactic("one")).rejects.toThrow(
			'Tactic "one" was not found.',
		);
	});

	it("initializes per-session tactics and user state, then selects matching tactics from business triggers", async () => {
		const conversations = await import("../../src/server/conversations");
		const tactics = await import("../../src/server/tactics");
		await writeJson("tactics.json", [
			tactic("one", ["please"], 10),
			tactic("two", ["please"], 10),
			tactic("three", ["please"], 10),
			tactic("four", ["please"], 10),
			tactic("five", ["please"], 10),
			tactic("six", ["please"], 10),
			tactic("blocked-one", ["please"], 10),
		]);
		const conversation = await conversations.createConversation({
			title: "Tactics",
		});
		await tactics.initializeSessionTactics(conversation.id, [
			"one",
			"two",
			"three",
			"four",
			"five",
			"six",
			"blocked-one",
		]);
		await tactics.setUserState(conversation.id, [
			{
				key: "urgency",
				value: 70,
				source: "observed",
				confidence: 0.9,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
			{
				key: "frustration",
				value: 0,
				source: "inferred",
				confidence: 0.2,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
			{
				key: "confidence-needed",
				value: 0,
				source: "inferred",
				confidence: 0.2,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
			{
				key: "detail-tolerance",
				value: 0,
				source: "inferred",
				confidence: 0.2,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		vi.spyOn(Math, "random").mockReturnValue(0);
		const selection = await tactics.selectTactics({
			conversationId: conversation.id,
			message: "please do this",
		});
		expect(selection.loaded).toHaveLength(5);
		expect(
			selection.decisions.filter((decision) => decision.decision === "skipped"),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					reasons: expect.arrayContaining([
						"randomly skipped because more than 5 tactics matched",
					]),
				}),
			]),
		);
		expect(tactics.buildTacticsGuidance(selection.loaded)).toContain(
			"Optional response tactics",
		);
		expect(
			await tactics.listRecentTacticRuns(conversation.id, 100),
		).toHaveLength(7);

		const blocked = await tactics.selectTactics({
			conversationId: conversation.id,
			message: "please but blocked",
		});
		expect(
			blocked.decisions.find((decision) => decision.tacticId === "blocked-one"),
		).toMatchObject({
			loaded: false,
			contraindications: ["blocked"],
		});
		expect(await tactics.listUserState()).toHaveLength(4);
		expect(await tactics.listTacticsOverview(conversation.id)).toHaveLength(7);
	});

	it("keeps session tactic choices stable and reports no guidance when no tactic is triggered", async () => {
		const conversations = await import("../../src/server/conversations");
		const tactics = await import("../../src/server/tactics");
		await writeJson("tactics.json", [
			{
				id: "calm",
				name: "Calm",
				keywords: ["calm"],
				emotionRules: [{ key: "urgency", operator: "<=", value: 10 }],
				blockedKeywords: [],
				instruction: "Stay calm.",
			},
			{
				id: "missing-state",
				name: "Missing state",
				keywords: [],
				emotionRules: [{ key: "confidence-needed", operator: ">=", value: 10 }],
				blockedKeywords: [],
				instruction: "Support confidence.",
			},
		]);
		const all = await conversations.createConversation({
			title: "All tactics",
		});
		await expect(tactics.initializeSessionTactics(all.id)).resolves.toEqual([
			"calm",
			"missing-state",
		]);
		const conversation = await conversations.createConversation({
			title: "Stable tactics",
		});
		await expect(
			tactics.initializeSessionTactics(conversation.id, ["calm"]),
		).resolves.toEqual(["calm"]);
		await expect(
			tactics.initializeSessionTactics(conversation.id, ["missing-state"]),
		).resolves.toEqual(["calm"]);
		await tactics.setUserState(conversation.id, [
			{
				key: "urgency",
				value: 30,
				source: "inferred",
				confidence: 0.2,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		]);

		const noTrigger = await tactics.selectTactics({
			conversationId: conversation.id,
			message: "nothing relevant",
		});
		expect(noTrigger.loaded).toEqual([]);
		expect(noTrigger.decisions).toMatchObject([
			{ tacticId: "calm", reasons: ["no trigger matched"] },
		]);
		expect(tactics.buildTacticsGuidance([])).toBe("");

		await tactics.setUserState(conversation.id, [
			{
				key: "urgency",
				value: 5,
				source: "inferred",
				confidence: 0.2,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		const emotionOnly = await tactics.selectTactics({
			conversationId: conversation.id,
			message: "still no keyword",
		});
		expect(emotionOnly.loaded).toMatchObject([{ id: "calm", score: 0.35 }]);

		const sparse = await conversations.createConversation({
			title: "Sparse tactic state",
		});
		await expect(
			tactics.initializeSessionTactics(
				sparse.id,
				["missing-state"],
				["urgency"],
			),
		).rejects.toThrow(
			"Selected tactics require missing session states: confidence-needed.",
		);

		const legacySparse = await conversations.createConversation({
			title: "Sparse legacy state",
		});
		await conversations.setSessionTacticIds(legacySparse.id, ["missing-state"]);
		await tactics.setUserState(legacySparse.id, [
			{
				key: "urgency",
				value: 5,
				source: "inferred",
				confidence: 0.2,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		expect(
			await tactics.selectTactics({
				conversationId: legacySparse.id,
				message: "still no keyword",
			}),
		).toMatchObject({
			loaded: [],
			decisions: [
				{ tacticId: "missing-state", reasons: ["no trigger matched"] },
			],
		});
	});

	it("manages global state definitions and protects states used by tactics", async () => {
		const tactics = await import("../../src/server/tactics");
		await expect(tactics.listStateDefinitions()).resolves.toEqual(
			defaultStateDefinitions,
		);
		await expect(
			tactics.createStateDefinition({
				id: "trust",
				name: " Trust ",
				description: " Willingness to open up ",
				defaultValue: 60,
			}),
		).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "trust",
					name: "Trust",
					description: "Willingness to open up",
				}),
			]),
		);
		await expect(
			tactics.createStateDefinition({
				id: "trust",
				name: "Trust",
				defaultValue: 60,
			}),
		).rejects.toThrow('State "trust" already exists.');
		await expect(
			tactics.updateStateDefinition("trust", {
				id: "ignored",
				name: "Trust level",
				defaultValue: 70,
			}),
		).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "trust", name: "Trust level" }),
			]),
		);
		await tactics.createTactic({
			id: "trust-builder",
			name: "Trust builder",
			keywords: [],
			emotionRules: [{ key: "trust", operator: "<=", value: 50 }],
			blockedKeywords: [],
			instruction: "Build trust.",
		});
		await expect(tactics.deleteStateDefinition("trust")).rejects.toThrow(
			'State "trust" is used by tactics: Trust builder.',
		);
		await tactics.deleteTactic("trust-builder");
		await expect(tactics.deleteStateDefinition("trust")).resolves.not.toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "trust" })]),
		);
		await expect(tactics.deleteStateDefinition("trust")).rejects.toThrow(
			'State "trust" was not found.',
		);
		await expect(
			tactics.updateStateDefinition("missing", {
				id: "missing",
				name: "Missing",
				defaultValue: 50,
			}),
		).rejects.toThrow('State "missing" was not found.');
		await expect(
			tactics.createStateDefinition({
				id: "bad id",
				name: "Bad",
				defaultValue: 50,
			}),
		).rejects.toThrow();
		await expect(tactics.createStateDefinition({} as never)).rejects.toThrow();
	});

	it("skips a winning tactic if the tactic library changes before details are loaded", async () => {
		const conversations = await import("../../src/server/conversations");
		const tactics = await import("../../src/server/tactics");
		await writeJson(
			"tactics.json",
			Array.from({ length: 6 }, (_, index) =>
				tactic(`race-${index + 1}`, ["match"]),
			),
		);
		const conversation = await conversations.createConversation({
			title: "Race",
		});
		await tactics.initializeSessionTactics(
			conversation.id,
			Array.from({ length: 6 }, (_, index) => `race-${index + 1}`),
		);
		vi.spyOn(Math, "random").mockImplementation(() => {
			writeFileSync(join(dataDir, "tactics.json"), "[]\n", "utf8");
			return 0;
		});

		const selection = await tactics.selectTactics({
			conversationId: conversation.id,
			message: "match",
		});
		expect(selection.decisions.some((decision) => decision.loaded)).toBe(true);
		expect(selection.loaded).toEqual([]);
	});

	it("normalizes invalid tactic drafts before validation", async () => {
		const tactics = await import("../../src/server/tactics");
		await expect(
			tactics.createTactic({
				id: "Invalid ID",
				name: "",
				keywords: [" x "],
				emotionRules: [{ key: "urgency", operator: ">=", value: Number.NaN }],
				blockedKeywords: [],
				instruction: "",
			}),
		).rejects.toThrow();
		await expect(tactics.createTactic({} as never)).rejects.toThrow();
		await expect(
			tactics.createTactic({
				id: "valid-id",
				name: "Valid",
				keywords: "not an array" as never,
				emotionRules: "not an array" as never,
				blockedKeywords: "not an array" as never,
				instruction: " Instruction ",
			}),
		).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "valid-id",
					keywords: [],
					emotionRules: [],
				}),
			]),
		);
		await expect(
			tactics.createTactic({
				id: "coerced-rule",
				name: "Coerced rule",
				keywords: [],
				emotionRules: [{ key: "urgency", operator: "<=", value: "7" as never }],
				blockedKeywords: [],
				instruction: "Use it",
			}),
		).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "coerced-rule",
					emotionRules: [{ key: "urgency", operator: "<=", value: 7 }],
				}),
			]),
		);
		await expect(
			tactics.createTactic({
				id: "unknown-state",
				name: "Unknown state",
				keywords: [],
				emotionRules: [{ key: "unknown", operator: ">=", value: 1 }],
				blockedKeywords: [],
				instruction: "Use it",
			}),
		).rejects.toThrow("Tactic requires unknown states: unknown.");
	});

	it("creates missing tactic storage on demand and rejects unreadable or malformed tactic storage", async () => {
		const tactics = await import("../../src/server/tactics");
		expect(await tactics.listTacticsOverview()).toEqual([]);

		await useTempDataDir();
		await mkdir(join(dataDir, "tactics.json"), { recursive: true });
		const unreadable = await import("../../src/server/tactics");
		await expect(unreadable.initializeTacticStore()).rejects.not.toThrow(
			"ENOENT",
		);

		await useTempDataDir();
		await writeFile(join(dataDir, "tactics.json"), "{bad json}", "utf8");
		const malformed = await import("../../src/server/tactics");
		await expect(malformed.listTacticsOverview()).rejects.toThrow();

		await useTempDataDir();
		await writeFile(join(dataDir, "states.json"), "{bad json}", "utf8");
		const malformedStates = await import("../../src/server/tactics");
		await expect(malformedStates.listStateDefinitions()).rejects.toThrow();
	});
});
