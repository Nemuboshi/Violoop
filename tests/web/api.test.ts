// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createConversation,
	deleteConversation,
	fetchConversation,
	fetchConversations,
	renameConversation,
} from "../../src/web/entities/conversation";
import { testProviderConnection } from "../../src/web/entities/provider";
import {
	deleteStateDefinition,
	deleteTactic,
	fetchTacticsStatus,
	saveStateDefinition,
	saveTactic,
} from "../../src/web/entities/tactic";
import { sendChatMessage } from "../../src/web/features/chat-session";
import { editLastUserMessage } from "../../src/web/features/chat-session/api/chatApi";
import {
	fetchConfig,
	saveConfig,
} from "../../src/web/features/config-settings";
import { fetchJson, fetchJsonOrNull } from "../../src/web/shared/api";
import {
	clearAllLocalData,
	markLocalSeedComplete,
	saveConfig as saveRepoConfig,
} from "../../src/web/shared/storage/repository";

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
	return new Response(JSON.stringify(payload), {
		status: init.status ?? 200,
		headers: { "Content-Type": "application/json" },
	});
}

function mockFetch(...responses: Array<Response | (() => Response)>) {
	const fetchMock = vi.fn(async () => {
		const next = responses.shift();
		if (!next) {
			throw new Error("Unexpected fetch call");
		}
		return typeof next === "function" ? next() : next;
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

const profile = {
	assistantName: "Violoop",
	userRole: "User",
	assistantRole: "Assistant",
};

const capabilities = {
	tactics: false,
	dayProgression: false,
	sessionState: false,
	sceneEvents: false,
};

const seedConfig = {
	chat: {
		defaultProvider: "local",
		defaultModel: "model-a",
		systemPrompt: "System",
		temperature: 0.7,
		thinkingLevel: "off" as const,
		compaction: {
			enabled: true,
			triggerTokens: 1000,
			keepRecentTokens: 100,
		},
	},
	providers: {
		local: {
			baseUrl: "http://provider.test",
			api: "openai-completions" as const,
			models: [{ id: "model-a" }],
		},
	},
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("web api boundaries", () => {
	it("reads successful JSON, nullable JSON, and server error details", async () => {
		mockFetch(
			jsonResponse({ ok: true }),
			jsonResponse({ ok: true }),
			jsonResponse({ missing: true }, { status: 404 }),
			jsonResponse({ detail: "Detailed failure" }, { status: 400 }),
			jsonResponse({ error: "Error failure" }, { status: 500 }),
			new Response("not json", { status: 502 }),
		);

		await expect(fetchJson<{ ok: boolean }>("/ok")).resolves.toEqual({
			ok: true,
		});
		await expect(fetchJsonOrNull<{ ok: boolean }>("/ok-null")).resolves.toEqual(
			{ ok: true },
		);
		await expect(fetchJsonOrNull("/missing")).resolves.toBeNull();
		await expect(fetchJson("/bad-detail")).rejects.toThrow("Detailed failure");
		await expect(fetchJson("/bad-error")).rejects.toThrow("Error failure");
		await expect(fetchJson("/bad-text")).rejects.toThrow(
			"Request failed with 502",
		);
	});

	it("lets callers customize API error messages", async () => {
		mockFetch(jsonResponse({ error: "raw" }, { status: 409 }));

		await expect(
			fetchJson("/conflict", undefined, {
				errorMessage: (status, payload) => `${status}:${payload?.error}`,
			}),
		).rejects.toThrow("409:raw");
	});

	it("falls back cleanly when optional error fields are missing or mistyped", async () => {
		mockFetch(
			jsonResponse({}, { status: 409 }),
			jsonResponse({ detail: 123, error: "Fallback error" }, { status: 400 }),
			jsonResponse({ detail: 123, error: 456 }, { status: 500 }),
		);

		await expect(fetchJson("/conflict")).rejects.toThrow(
			"Request failed with 409",
		);
		await expect(fetchJson("/fallback-error")).rejects.toThrow(
			"Fallback error",
		);
		await expect(fetchJson("/generic-error")).rejects.toThrow(
			"Request failed with 500",
		);
	});

	it("normalizes provider test error details from provider routes", async () => {
		mockFetch(
			jsonResponse(
				{ error: "Provider route rejected the key" },
				{ status: 401 },
			),
			jsonResponse({ detail: "Provider rejected the key" }, { status: 401 }),
			jsonResponse({}, { status: 500 }),
		);

		await expect(
			testProviderConnection({
				providerId: "local",
				provider: {
					baseUrl: "http://provider.test",
					api: "openai-completions",
				},
				model: "model-a",
			}),
		).rejects.toThrow("Provider route rejected the key");
		await expect(
			testProviderConnection({
				providerId: "local",
				provider: {
					baseUrl: "http://provider.test",
					api: "openai-completions",
				},
				model: "model-a",
			}),
		).rejects.toThrow("Provider rejected the key");
		await expect(
			testProviderConnection({
				providerId: "local",
				provider: {
					baseUrl: "http://provider.test",
					api: "openai-completions",
				},
				model: "model-a",
			}),
		).rejects.toThrow("Provider test failed with 500");

		mockFetch(
			jsonResponse(
				{
					error: "Provider request failed with 400.",
					detail: '{"message":"unknown model"}',
				},
				{ status: 400 },
			),
		);
		await expect(
			testProviderConnection({
				providerId: "local",
				provider: {
					baseUrl: "http://provider.test",
					api: "openai-completions",
				},
				model: "model-a",
			}),
		).rejects.toThrow(
			'Provider request failed with 400.\n{"message":"unknown model"}',
		);
	});

	it("posts provider test requests through the Worker proxy", async () => {
		const fetchMock = mockFetch(
			jsonResponse({
				ok: true,
				provider: "local",
				model: "model-a",
				text: "ok",
			}),
		);

		await expect(
			testProviderConnection({
				providerId: "local",
				provider: seedConfig.providers.local,
				model: "model-a",
			}),
		).resolves.toMatchObject({ ok: true });

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/providers/test",
			expect.objectContaining({ method: "POST" }),
		);
	});
});

describe("local-only API facades", () => {
	beforeEach(async () => {
		await clearAllLocalData();
		await saveRepoConfig(seedConfig);
		await markLocalSeedComplete();
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url === "/api/chat") {
					return Response.json({
						text: JSON.stringify({
							messages: [{ kind: "chat", content: "Local answer" }],
						}),
						usage: { promptTokens: 1 },
					});
				}
				if (url === "/api/providers/test") {
					return Response.json({
						ok: true,
						provider: "local",
						model: "model-a",
						text: "ok",
					});
				}
				throw new Error(`Unexpected fetch: ${url}`);
			}),
		);
	});

	it("lists empty conversations and surfaces missing-conversation errors", async () => {
		await expect(fetchConversations()).resolves.toEqual([]);
		await expect(deleteConversation("gone")).rejects.toThrow(
			'Conversation "gone" was not found.',
		);
		await expect(renameConversation("gone", { title: "Gone" })).rejects.toThrow(
			'Conversation "gone" was not found.',
		);
		await expect(fetchConversation("missing")).rejects.toThrow(
			'Conversation "missing" was not found.',
		);
	});

	it("persists conversations, config, tactics, and chat through IndexedDB", async () => {
		await expect(fetchConfig()).resolves.toMatchObject({
			config: { chat: { defaultProvider: "local" } },
		});
		await expect(saveConfig(seedConfig)).resolves.toMatchObject({
			config: seedConfig,
		});

		const created = await createConversation({
			title: "Session",
			profile,
			capabilities,
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

		const tactic = {
			id: "calm",
			name: "Calm",
			keywords: ["please"],
			emotionRules: [],
			blockedKeywords: [],
			instruction: "Stay calm.",
		};
		const stateDefinition = {
			id: "urgency",
			name: "Urgency",
			defaultValue: 40,
		};

		await expect(
			saveTactic({ tactic, originalId: null }),
		).resolves.toMatchObject({
			tactics: expect.arrayContaining([
				expect.objectContaining({ id: "calm" }),
			]),
		});
		await expect(
			fetchTacticsStatus(created.conversation.id),
		).resolves.toMatchObject({
			tactics: expect.any(Array),
		});
		await expect(deleteTactic("calm")).resolves.toBeTruthy();
		await expect(
			saveStateDefinition({ state: stateDefinition, originalId: null }),
		).resolves.toMatchObject({
			stateDefinitions: expect.arrayContaining([
				expect.objectContaining({ id: "urgency" }),
			]),
		});
		await expect(deleteStateDefinition("urgency")).resolves.toBeTruthy();

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

		await expect(deleteConversation(created.conversation.id)).resolves.toEqual(
			[],
		);
	});
});
