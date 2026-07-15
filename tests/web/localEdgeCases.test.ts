// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VioloopConfig } from "../../src/shared/types";
import { renameConversation } from "../../src/web/entities/conversation";
import {
	deleteStateDefinition,
	deleteTactic,
	fetchTacticsStatus,
	saveStateDefinition,
	saveTactic,
} from "../../src/web/entities/tactic";
import { fetchConfig } from "../../src/web/features/config-settings";
import { createClientId } from "../../src/web/shared/lib/id";
import { exportLocalData } from "../../src/web/shared/storage/export";
import { importLocalData } from "../../src/web/shared/storage/import";
import {
	createLocalConversation,
	saveLocalConfig,
	saveLocalState,
} from "../../src/web/shared/storage/localData";
import {
	clearAllLocalData,
	deleteConversationLocal,
	replaceConversationTimelineLocal,
	saveUsageLocal,
} from "../../src/web/shared/storage/repository";

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
			models: [{ id: "model-a" }],
		},
	},
};

beforeEach(async () => {
	await clearAllLocalData();
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith("settings.json"))
				return new Response(JSON.stringify(config), { status: 200 });
			if (url.endsWith("tactics.json"))
				return new Response(JSON.stringify([]), { status: 200 });
			if (url.endsWith("states.json"))
				return new Response(JSON.stringify([]), { status: 200 });
			return new Response("missing", { status: 404 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("local facade and storage edge cases", () => {
	it("uses indexedDB facades for conversation and tactic mutations", async () => {
		await saveLocalConfig(config);
		const created = await createLocalConversation({
			title: "Rename me",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: true,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
			allowedTacticIds: [],
			enabledStateIds: [],
		});
		await expect(fetchConfig()).resolves.toMatchObject({
			provider: "local",
		});
		await expect(
			renameConversation(created.conversation.id, { title: "Renamed" }),
		).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: created.conversation.id,
					title: "Renamed",
				}),
			]),
		);
		await saveLocalState({ id: "mood", name: "Mood", defaultValue: 50 }, null);
		await saveTactic({
			tactic: {
				id: "calm",
				name: "Calm",
				keywords: ["please"],
				emotionRules: [{ key: "mood", operator: ">=", value: 10 }],
				blockedKeywords: [],
				instruction: "Stay calm.",
			},
			originalId: null,
		});
		await expect(
			fetchTacticsStatus(created.conversation.id),
		).resolves.toMatchObject({
			tactics: expect.arrayContaining([
				expect.objectContaining({ id: "calm" }),
			]),
		});
		await saveStateDefinition({
			state: { id: "mood", name: "Mood", defaultValue: 60 },
			originalId: "mood",
		});
		await deleteTactic("calm");
		await deleteStateDefinition("mood");
	});

	it("rejects invalid imports and maintains repository helpers", async () => {
		await saveLocalConfig(config);
		const created = await createLocalConversation({
			title: "Repo",
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
		await expect(
			importLocalData({
				...exported,
				tactics: [
					{
						id: "bad",
						name: "Bad",
						keywords: [],
						emotionRules: [{ key: "missing", operator: ">=", value: 1 }],
						blockedKeywords: [],
						instruction: "x",
					},
				],
			}),
		).rejects.toThrow("unknown states");
		const broken = structuredClone(exported);
		broken.conversations[0].clock = {
			conversationId: "wrong",
			day: 1,
			updatedAt: new Date().toISOString(),
		};
		await expect(importLocalData(broken)).rejects.toThrow("invalid clock");
		await saveUsageLocal("req-1", { promptTokens: 1 });
		await replaceConversationTimelineLocal(created.conversation, []);
		await deleteConversationLocal(created.conversation.id);
	});

	it("falls back when randomUUID is unavailable", () => {
		const randomUUID = globalThis.crypto.randomUUID;
		// @ts-expect-error test fallback
		globalThis.crypto.randomUUID = undefined;
		expect(createClientId("client")).toMatch(/^client-/);
		globalThis.crypto.randomUUID = randomUUID;
	});
});
