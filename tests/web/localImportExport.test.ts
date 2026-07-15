// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	StoredCompaction,
	TacticRunLogEntry,
	TimelineItem,
} from "../../src/shared/types";
import { createLocalConversation } from "../../src/web/features/chat-session/api/createLocalConversation";
import { sendLocalChatMessage } from "../../src/web/features/chat-session/api/localChat";
import {
	deleteLocal,
	getLocal,
	resetMemoryDatabase,
} from "../../src/web/shared/storage/database";
import {
	exportLocalData,
	serializeExport,
} from "../../src/web/shared/storage/export";
import { importLocalExport } from "../../src/web/shared/storage/exportActions";
import { importLocalData } from "../../src/web/shared/storage/import";
import {
	getLocalConversationPayload,
	saveLocalConfig,
	saveLocalTactic,
} from "../../src/web/shared/storage/localData";
import {
	clearAllLocalData,
	getConfig,
	listCompactionsLocal,
	listTacticRunsLocal,
	listTimelineItemsLocal,
	markLocalSeedComplete,
	saveCompactionLocal,
	saveConfig,
	saveSessionTacticIdsLocal,
	saveStateDefinitionLocal,
	saveTacticRunLocal,
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
