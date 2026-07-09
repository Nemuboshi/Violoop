import { afterEach, describe, expect, it, vi } from "vitest";
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
import {
	fetchConfig,
	saveConfig,
} from "../../src/web/features/config-settings";
import { fetchJson, fetchJsonOrNull } from "../../src/web/shared/api";

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

const conversation = {
	id: "c1",
	title: "Session",
	profile,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	messageCount: 1,
};

const clock = {
	conversationId: "c1",
	day: 1,
	updatedAt: "2026-01-01T00:00:00.000Z",
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("web api boundaries", () => {
	it("reads successful JSON, nullable JSON, and server error details", async () => {
		mockFetch(
			jsonResponse({ ok: true }),
			jsonResponse({ missing: true }, { status: 404 }),
			jsonResponse({ detail: "Detailed failure" }, { status: 400 }),
			jsonResponse({ error: "Error failure" }, { status: 500 }),
			new Response("not json", { status: 502 }),
		);

		await expect(fetchJson<{ ok: boolean }>("/ok")).resolves.toEqual({
			ok: true,
		});
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

	it("falls back cleanly when route responses omit optional collections or standard errors", async () => {
		mockFetch(
			jsonResponse({}),
			jsonResponse({}),
			jsonResponse({}),
			jsonResponse({}, { status: 409 }),
			jsonResponse({}, { status: 410 }),
			jsonResponse({}, { status: 422 }),
			jsonResponse({ detail: 123, error: "Fallback error" }, { status: 400 }),
			jsonResponse({ detail: 123, error: 456 }, { status: 500 }),
		);

		await expect(fetchConversations()).resolves.toEqual([]);
		await expect(deleteConversation("gone")).resolves.toEqual([]);
		await expect(
			renameConversation("gone", { title: "Gone" }),
		).resolves.toEqual([]);
		await expect(deleteConversation("gone")).rejects.toThrow(
			"Conversation delete failed with 409",
		);
		await expect(renameConversation("gone", { title: "Gone" })).rejects.toThrow(
			"Conversation rename failed with 410",
		);
		await expect(
			createConversation({
				title: "Bad",
				profile,
				allowedTacticIds: [],
			}),
		).rejects.toThrow("Conversation create failed with 422");
		await expect(fetchJson("/fallback-error")).rejects.toThrow(
			"Fallback error",
		);
		await expect(fetchJson("/generic-error")).rejects.toThrow(
			"Request failed with 500",
		);
	});

	it("uses conversation endpoints for listing, creation, restore, and delete", async () => {
		const timelineItems = [
			{
				id: "m1",
				conversationId: "c1",
				kind: "chat",
				role: "assistant",
				content: "Hello",
				promptVisibility: "visible",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		];
		const fetchMock = mockFetch(
			jsonResponse({ conversations: [conversation] }),
			jsonResponse({ conversations: [conversation] }),
			jsonResponse({ conversations: [{ ...conversation, title: "Renamed" }] }),
			jsonResponse({ conversation, clock, timelineItems }),
			jsonResponse({ conversation, clock, timelineItems }),
			jsonResponse({}),
			jsonResponse({}),
			jsonResponse({ detail: "No access" }, { status: 403 }),
		);

		await expect(fetchConversations()).resolves.toEqual([conversation]);
		await expect(deleteConversation("c1")).resolves.toEqual([conversation]);
		await expect(
			renameConversation("c1", { title: "Renamed" }),
		).resolves.toEqual([{ ...conversation, title: "Renamed" }]);
		await expect(
			createConversation({
				title: "New chat",
				profile,
				allowedTacticIds: ["calm"],
			}),
		).resolves.toMatchObject({ conversation, clock });
		await expect(fetchConversation("c1")).resolves.toMatchObject({
			conversation,
			clock,
		});
		await expect(fetchConversation("empty")).rejects.toThrow(
			"Conversation response was empty",
		);
		await expect(
			createConversation({
				title: "Empty",
				profile,
				allowedTacticIds: [],
			}),
		).rejects.toThrow("Conversation create response was empty");
		await expect(fetchConversation("private")).rejects.toThrow(
			"Conversation request failed with 403",
		);

		expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
			"/api/conversations",
			"/api/conversations/c1",
			"/api/conversations/c1",
			"/api/conversations",
			"/api/conversations/c1/messages",
			"/api/conversations/empty/messages",
			"/api/conversations",
			"/api/conversations/private/messages",
		]);
	});

	it("surfaces route-level validation failures for conversation mutations", async () => {
		mockFetch(
			jsonResponse({ error: "Cannot delete" }, { status: 400 }),
			jsonResponse({ error: "Cannot rename" }, { status: 400 }),
			jsonResponse({ error: "Cannot create" }, { status: 400 }),
		);

		await expect(deleteConversation("bad/id")).rejects.toThrow("Cannot delete");
		await expect(
			renameConversation("bad/id", { title: "Bad" }),
		).rejects.toThrow("Cannot rename");
		await expect(
			createConversation({
				title: "Bad",
				profile,
				allowedTacticIds: [],
			}),
		).rejects.toThrow("Cannot create");
	});

	it("uses provider, config, tactic, and chat endpoints with request payloads", async () => {
		const config = {
			chat: {
				defaultProvider: "local",
				defaultModel: "model-a",
				systemPrompt: "System",
				temperature: 0.7,
				thinkingLevel: "off",
				compaction: {
					enabled: true,
					triggerTokens: 1000,
					keepRecentTokens: 100,
				},
			},
			providers: {
				local: {
					baseUrl: "http://provider.test",
					api: "openai-completions",
					models: [{ id: "model-a" }],
				},
			},
		} as const;
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
		const fetchMock = mockFetch(
			jsonResponse({
				config,
				provider: "local",
				providerName: "local",
				baseUrl: "http://provider.test",
				api: "openai-completions",
				model: "model-a",
			}),
			jsonResponse({ config }),
			jsonResponse({
				ok: true,
				provider: "local",
				model: "model-a",
				text: "ok",
			}),
			jsonResponse({
				tactics: [{ ...tactic, allowedInSession: true, requiredStateIds: [] }],
				stateDefinitions: [stateDefinition],
				userState: [],
				clock,
				recentRuns: [],
			}),
			jsonResponse({
				tactics: [{ ...tactic, allowedInSession: false, requiredStateIds: [] }],
				stateDefinitions: [stateDefinition],
			}),
			jsonResponse({ tactics: [], stateDefinitions: [stateDefinition] }),
			jsonResponse({ tactics: [], stateDefinitions: [stateDefinition] }),
			jsonResponse({ tactics: [], stateDefinitions: [stateDefinition] }),
			jsonResponse({ tactics: [], stateDefinitions: [] }),
			jsonResponse({
				requestId: "r1",
				conversationId: "c1",
				tacticIds: [],
				clock,
				timelineItems: [],
				createdItems: [],
			}),
		);

		await expect(fetchConfig()).resolves.toMatchObject({ config });
		await expect(saveConfig(config)).resolves.toMatchObject({ config });
		await expect(
			testProviderConnection({
				providerId: "local",
				provider: config.providers.local,
				model: "model-a",
			}),
		).resolves.toMatchObject({ ok: true });
		await expect(fetchTacticsStatus("c1")).resolves.toMatchObject({
			tactics: [{ id: "calm" }],
			userState: [],
		});
		await expect(
			saveTactic({ tactic, originalId: null }),
		).resolves.toMatchObject({ tactics: [{ id: "calm" }] });
		await expect(
			saveTactic({ tactic, originalId: "calm" }),
		).resolves.toMatchObject({ tactics: [] });
		await expect(deleteTactic("calm")).resolves.toMatchObject({ tactics: [] });
		await expect(
			saveStateDefinition({ state: stateDefinition, originalId: null }),
		).resolves.toMatchObject({ stateDefinitions: [{ id: "urgency" }] });
		await expect(deleteStateDefinition("urgency")).resolves.toEqual({
			tactics: [],
			stateDefinitions: [],
		});
		await expect(
			sendChatMessage({ conversationId: "c1", message: "hello" }),
		).resolves.toMatchObject({ requestId: "r1" });

		expect(
			fetchMock.mock.calls.map(([url, init]) => [
				String(url),
				(init as RequestInit | undefined)?.method ?? "GET",
			]),
		).toEqual([
			["/api/config", "GET"],
			["/api/config", "PUT"],
			["/api/providers/test", "POST"],
			["/api/tactics?conversationId=c1", "GET"],
			["/api/tactics", "POST"],
			["/api/tactics/calm", "PUT"],
			["/api/tactics/calm", "DELETE"],
			["/api/tactics/states", "POST"],
			["/api/tactics/states/urgency", "DELETE"],
			["/api/chat", "POST"],
		]);
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
	});
});
