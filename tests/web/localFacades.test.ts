// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createConversation,
	fetchConversation,
	fetchConversations,
	renameConversation,
} from "../../src/web/entities/conversation";
import {
	deleteStateDefinition,
	deleteTactic,
	fetchTacticsStatus,
	saveStateDefinition,
	saveTactic,
} from "../../src/web/entities/tactic";
import {
	editLastUserMessage,
	sendChatMessage,
} from "../../src/web/features/chat-session/api/chatApi";
import {
	fetchConfig,
	saveConfig,
} from "../../src/web/features/config-settings";
import {
	clearAllLocalData,
	markLocalSeedComplete,
	saveConfig as saveRepoConfig,
} from "../../src/web/shared/storage/repository";

const config = {
	chat: {
		defaultProvider: "local",
		defaultModel: "model-a",
		systemPrompt: "System",
		compaction: {
			enabled: false,
			triggerTokens: 1000,
			keepRecentTokens: 100,
		},
	},
	providers: {
		local: {
			baseUrl: "https://provider.example/v1",
			api: "openai-completions" as const,
			models: [{ id: "model-a" }],
		},
	},
};

beforeEach(async () => {
	await clearAllLocalData();
	await saveRepoConfig(config);
	await markLocalSeedComplete();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json({
				text: JSON.stringify({
					messages: [{ kind: "chat", content: "Local answer" }],
				}),
				usage: { promptTokens: 1 },
			}),
		),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("local-only API facades", () => {
	it("routes config, conversations, tactics, and chat through IndexedDB", async () => {
		await expect(fetchConfig()).resolves.toMatchObject({
			config: { chat: { defaultProvider: "local" } },
		});
		await expect(saveConfig(config)).resolves.toMatchObject({ config });

		const created = await createConversation({
			title: "Session",
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
		expect(created.conversation.title).toBe("Session");
		await expect(fetchConversations()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: created.conversation.id }),
			]),
		);
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
		await expect(
			fetchConversation(created.conversation.id),
		).resolves.toMatchObject({
			conversation: { id: created.conversation.id },
		});
		await expect(
			fetchTacticsStatus(created.conversation.id),
		).resolves.toMatchObject({
			tactics: expect.any(Array),
		});
		await expect(
			sendChatMessage({
				conversationId: created.conversation.id,
				message: "hello",
			}),
		).resolves.toMatchObject({ conversationId: created.conversation.id });
		await expect(
			editLastUserMessage({
				conversationId: created.conversation.id,
				message: "edited",
			}),
		).resolves.toMatchObject({ conversationId: created.conversation.id });

		await expect(
			saveTactic({
				tactic: {
					id: "calm",
					name: "Calm",
					keywords: [],
					emotionRules: [],
					blockedKeywords: [],
					instruction: "Stay calm.",
				},
				originalId: null,
			}),
		).resolves.toBeTruthy();
		await expect(deleteTactic("calm")).resolves.toBeTruthy();
		await expect(
			saveStateDefinition({
				state: { id: "mood", name: "Mood", defaultValue: 50 },
				originalId: null,
			}),
		).resolves.toBeTruthy();
		await expect(deleteStateDefinition("mood")).resolves.toBeTruthy();
	});
});
