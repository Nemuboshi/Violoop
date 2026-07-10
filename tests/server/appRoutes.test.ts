import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VioloopConfig } from "../../src/shared/types";

let dataDir = "";

async function useTempDataDir() {
	dataDir = await mkdtemp(join(tmpdir(), "violoop-app-test-"));
	process.env.VIOLOOP_DATA_DIR = dataDir;
	vi.resetModules();
}

async function writeJson(name: string, value: unknown) {
	await writeFile(
		join(dataDir, name),
		`${JSON.stringify(value, null, 2)}\n`,
		"utf8",
	);
}

function validConfig(): VioloopConfig {
	return {
		chat: {
			defaultProvider: "local",
			defaultModel: "model-a",
			systemPrompt: "System",
			temperature: 0.4,
			thinkingLevel: "high",
			cache: { systemPrompt: true },
			compaction: {
				enabled: false,
				triggerTokens: 1000,
				keepRecentTokens: 100,
			},
		},
		providers: {
			local: {
				name: "Local",
				baseUrl: "http://provider.test/v1",
				api: "openai-completions",
				authHeader: false,
				models: [{ id: "model-a" }],
			},
		},
	};
}

function streamResponse(content: string, usage?: Record<string, unknown>) {
	return new Response(
		[
			`data: ${JSON.stringify({ choices: [{ delta: { content } }], usage })}`,
			"data: [DONE]",
		].join("\n"),
		{ status: 200, headers: { "Content-Type": "text/event-stream" } },
	);
}

beforeEach(async () => {
	await useTempDataDir();
	await writeJson("settings.json", validConfig());
	await writeJson("tactics.json", [
		{
			id: "calm",
			name: "Calm",
			keywords: ["please"],
			emotionRules: [],
			blockedKeywords: [],
			instruction: "Keep the answer calm.",
		},
	]);
});

afterEach(async () => {
	vi.unstubAllGlobals();
	delete process.env.VIOLOOP_DATA_DIR;
	await rm(dataDir, { recursive: true, force: true });
});

describe("fastify api app", () => {
	it("serves config endpoints through Fastify with CORS and validation errors", async () => {
		const { buildApp } = await import("../../src/server/app");
		const app = await buildApp({
			corsOrigins: ["http://127.0.0.1:5173", "http://127.0.0.1:5174"],
		});
		app.get("/test-unknown-error", async () => {
			throw "unknown";
		});

		const health = await app.inject({
			method: "GET",
			url: "/api/health",
			headers: { origin: "http://127.0.0.1:5173" },
		});
		expect(health.statusCode).toBe(200);
		expect(health.headers["access-control-allow-origin"]).toBe(
			"http://127.0.0.1:5173",
		);
		expect(health.json()).toEqual({ ok: true });

		const config = await app.inject({ method: "GET", url: "/api/config" });
		expect(config.statusCode).toBe(200);
		expect(config.json()).toMatchObject({
			provider: "local",
			model: "model-a",
		});

		const invalidSave = await app.inject({
			method: "PUT",
			url: "/api/config",
			payload: {},
		});
		expect(invalidSave.statusCode).toBe(400);
		expect(invalidSave.json()).toEqual({
			error: "Config payload is required.",
		});

		const savedConfig = {
			...validConfig(),
			chat: { ...validConfig().chat, thinkingLevel: "xhigh" as const },
		};
		const saved = await app.inject({
			method: "PUT",
			url: "/api/config",
			payload: { config: savedConfig },
		});
		expect(saved.statusCode).toBe(200);
		expect(saved.json()).toMatchObject({
			config: { chat: { thinkingLevel: "xhigh" } },
		});

		const noCacheConfig = {
			...validConfig(),
			chat: { ...validConfig().chat, cache: undefined },
		};
		await app.inject({
			method: "PUT",
			url: "/api/config",
			payload: { config: noCacheConfig },
		});
		const noCache = await app.inject({ method: "GET", url: "/api/config" });
		expect(noCache.json()).toMatchObject({ cache: { systemPrompt: false } });

		const invalidJson = await app.inject({
			method: "POST",
			url: "/api/chat",
			headers: { "content-type": "application/json" },
			payload: "{bad json",
		});
		expect(invalidJson.statusCode).toBe(400);
		expect(invalidJson.json().error).toContain("JSON");

		const unknown = await app.inject({
			method: "GET",
			url: "/test-unknown-error",
		});
		expect(unknown.statusCode).toBe(500);
		expect(unknown.json()).toEqual({ error: "Unexpected server error" });

		await app.close();
	});

	it("creates, restores, chats in, and deletes a conversation through Fastify routes", async () => {
		const providerFetch = vi
			.fn()
			.mockResolvedValueOnce(
				streamResponse(JSON.stringify({ scenes: ["Opening scene."] })),
			)
			.mockResolvedValueOnce(
				streamResponse(
					JSON.stringify({
						messages: [{ kind: "chat", content: "Structured answer." }],
						runtimeActions: [
							{
								tool: "emit_scene",
								arguments: { content: "Later scene." },
							},
						],
					}),
					{
						prompt_tokens: 8,
						completion_tokens: 3,
						total_tokens: 11,
						prompt_tokens_details: { cached_tokens: 2 },
					},
				),
			)
			.mockResolvedValueOnce(
				streamResponse(
					JSON.stringify({
						messages: [{ kind: "chat", content: "Regenerated answer." }],
					}),
				),
			);
		vi.stubGlobal("fetch", providerFetch);

		const { buildApp } = await import("../../src/server/app");
		const app = await buildApp({
			corsOrigins: ["http://127.0.0.1:5173", "http://127.0.0.1:5174"],
		});

		const created = await app.inject({
			method: "POST",
			url: "/api/conversations",
			payload: {
				title: "New chat",
				profile: {
					assistantName: "Ava",
					userRole: "Visitor",
					assistantRole: "Host",
				},
				capabilities: {
					tactics: true,
					dayProgression: true,
					sessionState: true,
					sceneEvents: true,
				},
				allowedTacticIds: ["calm"],
			},
		});
		expect(created.statusCode).toBe(200);
		expect(created.json()).toMatchObject({
			conversation: { title: "New chat", profile: { assistantName: "Ava" } },
			clock: { day: 1 },
			timelineItems: [
				{ kind: "day_transition", content: "Day 1" },
				{ kind: "scene", content: "Opening scene." },
			],
		});
		const conversationId = created.json().conversation.id as string;

		const tactics = await app.inject({
			method: "GET",
			url: `/api/tactics?conversationId=${conversationId}`,
		});
		expect(tactics.statusCode).toBe(200);
		expect(tactics.json()).toMatchObject({
			tactics: [{ id: "calm", allowedInSession: true }],
			clock: { day: 1 },
		});

		const chat = await app.inject({
			method: "POST",
			url: "/api/chat",
			payload: { conversationId, message: "please help" },
		});
		expect(chat.statusCode).toBe(200);
		expect(chat.json()).toMatchObject({
			conversationId,
			tacticIds: ["calm"],
			usage: {
				promptTokens: 8,
				completionTokens: 3,
				totalTokens: 11,
				cachedPromptTokens: 2,
			},
			createdItems: [
				{ kind: "chat", content: "Structured answer." },
				{ kind: "scene", content: "Later scene." },
			],
		});

		const usage = await app.inject({
			method: "GET",
			url: `/api/usage/${chat.json().requestId}`,
		});
		expect(usage.json()).toMatchObject({
			usage: { promptTokens: 8, cachedPromptTokens: 2 },
		});

		const edited = await app.inject({
			method: "POST",
			url: "/api/chat/edit-last",
			payload: { conversationId, message: "please revise" },
		});
		expect(edited.statusCode).toBe(200);
		expect(
			edited
				.json()
				.timelineItems.map((item: { content: string }) => item.content),
		).toEqual(expect.arrayContaining(["please revise", "Regenerated answer."]));
		expect(
			edited
				.json()
				.timelineItems.map((item: { content: string }) => item.content),
		).not.toContain("Structured answer.");

		const restored = await app.inject({
			method: "GET",
			url: `/api/conversations/${conversationId}/messages`,
		});
		expect(
			restored
				.json()
				.timelineItems.map((item: { content: string }) => item.content),
		).toContain("Regenerated answer.");

		const listed = await app.inject({
			method: "GET",
			url: "/api/conversations",
		});
		expect(listed.statusCode).toBe(200);
		expect(listed.json().conversations).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: conversationId })]),
		);

		const renamed = await app.inject({
			method: "PATCH",
			url: `/api/conversations/${conversationId}`,
			payload: { title: "Renamed session" },
		});
		expect(renamed.statusCode).toBe(200);
		expect(renamed.json().conversations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: conversationId,
					title: "Renamed session",
				}),
			]),
		);

		const missingConversation = await app.inject({
			method: "GET",
			url: "/api/conversations/missing/messages",
		});
		expect(missingConversation.statusCode).toBe(404);
		expect(missingConversation.json()).toEqual({
			error: 'Conversation "missing" was not found.',
		});

		const deleted = await app.inject({
			method: "DELETE",
			url: `/api/conversations/${conversationId}`,
		});
		expect(deleted.statusCode).toBe(200);
		expect(deleted.json()).toEqual({ conversations: [] });

		await app.close();
	});

	it("creates generic sessions without runtime setup and applies state runtime actions only when enabled", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				streamResponse(
					JSON.stringify({
						messages: [{ kind: "chat", content: "State noted." }],
						runtimeActions: [
							{
								tool: "emit_scene",
								arguments: { content: "Ignored scene." },
							},
							{
								tool: "update_session_state",
								arguments: {
									patches: [
										{ key: "urgency", delta: 3, reason: "clear signal" },
										{ delta: 1, reason: "missing key ignored" },
									],
									note: "Updated from main reply.",
								},
							},
						],
					}),
				),
			),
		);
		const { buildApp } = await import("../../src/server/app");
		const app = await buildApp({
			corsOrigins: ["http://127.0.0.1:5173", "http://127.0.0.1:5174"],
		});

		const generic = await app.inject({
			method: "POST",
			url: "/api/conversations",
			payload: {
				title: "Generic",
				capabilities: {
					tactics: false,
					dayProgression: false,
					sessionState: false,
					sceneEvents: false,
				},
			},
		});
		expect(generic.statusCode).toBe(200);
		expect(generic.json()).toMatchObject({
			clock: null,
			timelineItems: [],
			conversation: {
				capabilities: {
					tactics: false,
					dayProgression: false,
					sessionState: false,
					sceneEvents: false,
				},
			},
		});
		const defaultCapabilities = await app.inject({
			method: "POST",
			url: "/api/conversations",
			payload: { title: "Default capabilities" },
		});
		expect(defaultCapabilities.json()).toMatchObject({
			conversation: {
				capabilities: {
					tactics: true,
					dayProgression: false,
					sessionState: false,
					sceneEvents: false,
				},
			},
		});
		const restoredGeneric = await app.inject({
			method: "GET",
			url: `/api/conversations/${generic.json().conversation.id}/messages`,
		});
		expect(restoredGeneric.json()).toMatchObject({ clock: null });
		const tacticalNoState = await app.inject({
			method: "POST",
			url: "/api/conversations",
			payload: {
				title: "Tactics only",
				capabilities: {
					tactics: true,
					dayProgression: false,
					sessionState: false,
					sceneEvents: false,
				},
				allowedTacticIds: [],
			},
		});
		expect(tacticalNoState.json()).toMatchObject({
			clock: null,
			timelineItems: [],
		});
		await app.inject({
			method: "POST",
			url: "/api/tactics/states",
			payload: {
				state: {
					id: "urgency",
					name: "Urgency",
					defaultValue: 40,
				},
			},
		});
		await app.inject({
			method: "PUT",
			url: "/api/tactics/calm",
			payload: {
				tactic: {
					id: "calm",
					name: "Calm",
					keywords: ["please"],
					emotionRules: [{ key: "urgency", operator: ">=", value: 40 }],
					blockedKeywords: [],
					instruction: "Keep the answer calm.",
				},
			},
		});
		const autoState = await app.inject({
			method: "POST",
			url: "/api/conversations",
			payload: {
				title: "Auto state",
				capabilities: {
					tactics: true,
					dayProgression: false,
					sessionState: false,
					sceneEvents: false,
				},
				allowedTacticIds: ["calm"],
			},
		});
		expect(autoState.json()).toMatchObject({
			conversation: { capabilities: { sessionState: true } },
		});
		const genericConversationId = generic.json().conversation.id as string;
		await app.inject({
			method: "POST",
			url: "/api/chat",
			payload: { conversationId: genericConversationId, message: "hello" },
		});
		const editedGeneric = await app.inject({
			method: "POST",
			url: "/api/chat/edit-last",
			payload: { conversationId: genericConversationId, message: "edited" },
		});
		expect(editedGeneric.json()).toMatchObject({ clock: null });

		const stateful = await app.inject({
			method: "POST",
			url: "/api/conversations",
			payload: {
				title: "Stateful",
				capabilities: {
					tactics: true,
					dayProgression: false,
					sessionState: true,
					sceneEvents: false,
				},
				allowedTacticIds: [],
				enabledStateIds: ["urgency"],
			},
		});
		const conversationId = stateful.json().conversation.id as string;
		const chat = await app.inject({
			method: "POST",
			url: "/api/chat",
			payload: { conversationId, message: "note this" },
		});
		expect(chat.statusCode).toBe(200);
		expect(chat.json()).toMatchObject({
			clock: null,
			createdItems: [{ kind: "chat", content: "State noted." }],
		});
		expect(
			chat
				.json()
				.timelineItems.find(
					(item: { kind: string }) => item.kind === "state_update",
				),
		).toMatchObject({
			content: "Updated from main reply.",
			metadata: {
				patches: [{ key: "urgency", previousValue: 40, nextValue: 43 }],
			},
		});

		await app.close();
	});

	it("maps provider and request validation failures to JSON API errors", async () => {
		const { buildApp } = await import("../../src/server/app");
		const app = await buildApp({
			corsOrigins: ["http://127.0.0.1:5173", "http://127.0.0.1:5174"],
		});

		const missingProvider = await app.inject({
			method: "POST",
			url: "/api/providers/test",
			payload: {},
		});
		expect(missingProvider.statusCode).toBe(400);
		expect(missingProvider.json()).toEqual({
			error: "Provider and model are required.",
		});

		const missingProviderWithModel = await app.inject({
			method: "POST",
			url: "/api/providers/test",
			payload: { model: "model-a" },
		});
		expect(missingProviderWithModel.statusCode).toBe(400);
		expect(missingProviderWithModel.json()).toEqual({
			error: "Provider and model are required.",
		});

		const missingModel = await app.inject({
			method: "POST",
			url: "/api/providers/test",
			payload: { provider: validConfig().providers.local },
		});
		expect(missingModel.statusCode).toBe(400);
		expect(missingModel.json()).toEqual({
			error: "Provider and model are required.",
		});

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("upstream rejected", { status: 429 })),
		);
		const providerFailure = await app.inject({
			method: "POST",
			url: "/api/providers/test",
			payload: {
				providerId: "draft",
				provider: validConfig().providers.local,
				model: "model-a",
			},
		});
		expect(providerFailure.statusCode).toBe(429);
		expect(providerFailure.json()).toEqual({
			error: "Provider request failed with 429.",
			detail: "upstream rejected",
		});

		const missingMessage = await app.inject({
			method: "POST",
			url: "/api/chat",
			payload: { conversationId: "missing", message: " " },
		});
		expect(missingMessage.statusCode).toBe(400);
		expect(missingMessage.json()).toEqual({
			error: "A user message is required.",
		});

		const missingConversationId = await app.inject({
			method: "POST",
			url: "/api/chat",
			payload: { message: "hello" },
		});
		expect(missingConversationId.statusCode).toBe(400);
		expect(missingConversationId.json()).toEqual({
			error:
				"A conversationId is required. Start a new chat before sending a message.",
		});

		const missingConversation = await app.inject({
			method: "POST",
			url: "/api/chat",
			payload: { conversationId: "missing", message: "hello" },
		});
		expect(missingConversation.statusCode).toBe(404);
		expect(missingConversation.json()).toEqual({
			error: 'Conversation "missing" was not found.',
		});

		const nonStringMessage = await app.inject({
			method: "POST",
			url: "/api/chat",
			payload: { conversationId: "missing", message: 1 },
		});
		expect(nonStringMessage.statusCode).toBe(400);
		expect(nonStringMessage.json()).toEqual({
			error: "A user message is required.",
		});

		const emptyEditMessage = await app.inject({
			method: "POST",
			url: "/api/chat/edit-last",
			payload: { conversationId: "missing", message: "" },
		});
		expect(emptyEditMessage.statusCode).toBe(400);
		expect(emptyEditMessage.json()).toEqual({
			error: "A user message is required.",
		});

		const missingEditConversationId = await app.inject({
			method: "POST",
			url: "/api/chat/edit-last",
			payload: { message: "hello" },
		});
		expect(missingEditConversationId.statusCode).toBe(400);
		expect(missingEditConversationId.json()).toEqual({
			error:
				"A conversationId is required. Start a new chat before sending a message.",
		});

		const missingEditConversation = await app.inject({
			method: "POST",
			url: "/api/chat/edit-last",
			payload: { conversationId: "missing", message: "hello" },
		});
		expect(missingEditConversation.statusCode).toBe(404);
		expect(missingEditConversation.json()).toEqual({
			error: 'Conversation "missing" was not found.',
		});

		const { createConversation } = await import(
			"../../src/server/conversations"
		);
		const emptyConversation = await createConversation({ title: "Empty" });
		const editWithoutUserMessage = await app.inject({
			method: "POST",
			url: "/api/chat/edit-last",
			payload: { conversationId: emptyConversation.id, message: "hello" },
		});
		expect(editWithoutUserMessage.statusCode).toBe(409);
		expect(editWithoutUserMessage.json()).toEqual({
			error: "No user message is available to edit.",
		});

		const { appendTimelineItem } = await import(
			"../../src/server/conversations"
		);
		const manualConversation = await createConversation({
			title: "Manual",
			capabilities: {
				tactics: true,
				dayProgression: true,
				sessionState: false,
				sceneEvents: false,
			},
		});
		await appendTimelineItem({
			conversationId: manualConversation.id,
			kind: "day_transition",
			role: "system",
			content: "Day unknown",
			promptVisibility: "context",
		});
		await appendTimelineItem({
			conversationId: manualConversation.id,
			kind: "chat",
			role: "user",
			content: "old manual message",
			promptVisibility: "visible",
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				streamResponse(
					JSON.stringify({
						messages: [{ kind: "chat", content: "Manual regenerate." }],
					}),
				),
			),
		);
		const editWithUnmarkedDay = await app.inject({
			method: "POST",
			url: "/api/chat/edit-last",
			payload: {
				conversationId: manualConversation.id,
				message: "new manual message",
			},
		});
		expect(editWithUnmarkedDay.statusCode).toBe(200);
		expect(editWithUnmarkedDay.json()).toMatchObject({
			clock: { day: 1 },
			createdItems: [{ content: "Manual regenerate." }],
		});

		await app.close();
	});

	it("supports provider tests, tactic mutations, and chat fallback response shapes", async () => {
		const providerFetch = vi
			.fn()
			.mockResolvedValueOnce(
				streamResponse(`${"O".repeat(80)}`, { prompt_tokens: 1 }),
			)
			.mockResolvedValueOnce(streamResponse("OK", { prompt_tokens: 1 }))
			.mockResolvedValueOnce(streamResponse("OK"))
			.mockResolvedValueOnce(streamResponse(JSON.stringify({ scenes: [] })))
			.mockResolvedValueOnce(streamResponse("[scene]\nPlain fallback"))
			.mockResolvedValueOnce(streamResponse(JSON.stringify({ scenes: [] })))
			.mockResolvedValueOnce(streamResponse("{bad}"))
			.mockResolvedValueOnce(streamResponse(JSON.stringify({ scenes: [] })))
			.mockResolvedValueOnce(
				streamResponse(JSON.stringify({ messages: { bad: true } })),
			)
			.mockResolvedValueOnce(streamResponse(JSON.stringify({ scenes: [] })))
			.mockResolvedValueOnce(
				streamResponse(
					JSON.stringify({
						messages: [{ kind: "scene", content: "ignored" }, { kind: "chat" }],
					}),
				),
			)
			.mockResolvedValueOnce(streamResponse(JSON.stringify({ scenes: [] })))
			.mockResolvedValueOnce(
				streamResponse(
					JSON.stringify({
						messages: [],
						runtimeActions: [
							{
								tool: "advance_day",
								arguments: { content: "", scene: "Advance scene." },
							},
							{
								tool: "emit_scene",
								arguments: { content: "Next day scene." },
							},
							{ tool: "emit_scene", arguments: { content: "" } },
							{ tool: "emit_scene", arguments: { content: "Too many." } },
						],
					}),
				),
			)
			.mockRejectedValueOnce("state updater offline")
			.mockResolvedValueOnce(streamResponse(JSON.stringify({ scenes: [] })))
			.mockResolvedValueOnce(
				streamResponse(
					JSON.stringify({
						messages: [
							{ kind: "chat", content: "One" },
							{ kind: "chat", content: "Two" },
						],
					}),
				),
			)
			.mockResolvedValueOnce(streamResponse(JSON.stringify({ scenes: [] })))
			.mockResolvedValueOnce(
				streamResponse(
					JSON.stringify({
						messages: [{ kind: "chat", content: "Before next day." }],
						runtimeActions: [
							{
								tool: "advance_day",
								arguments: { content: "Day rises.", scene: null },
							},
						],
					}),
				),
			)
			.mockRejectedValueOnce(new Error("state failed"));
		vi.stubGlobal("fetch", providerFetch);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		const { buildApp } = await import("../../src/server/app");
		const app = await buildApp({
			corsOrigins: ["http://127.0.0.1:5173", "http://127.0.0.1:5174"],
		});

		const tacticsWithoutConversation = await app.inject({
			method: "GET",
			url: "/api/tactics",
		});
		expect(tacticsWithoutConversation.statusCode).toBe(200);
		expect(tacticsWithoutConversation.json()).toMatchObject({ clock: null });

		const providerOk = await app.inject({
			method: "POST",
			url: "/api/providers/test",
			payload: {
				providerId: "draft",
				provider: {
					baseUrl: "http://provider.test/v1///",
					api: "openai-completions",
				},
				model: "ad-hoc",
			},
		});
		expect(providerOk.statusCode).toBe(200);
		expect(providerOk.json()).toMatchObject({
			ok: true,
			provider: "draft",
			model: "ad-hoc",
			text: "O".repeat(80),
		});

		const providerWithUsage = await app.inject({
			method: "POST",
			url: "/api/providers/test",
			payload: {
				providerId: "draft",
				provider: {
					baseUrl: "http://provider.test/v1///",
					api: "openai-completions",
				},
				model: "ad-hoc",
			},
		});
		expect(providerWithUsage.statusCode).toBe(200);
		expect(providerWithUsage.json()).toMatchObject({
			text: "OK",
			usage: { promptTokens: 1 },
		});

		const providerWithDefaultId = await app.inject({
			method: "POST",
			url: "/api/providers/test",
			payload: {
				provider: {
					baseUrl: "http://provider.test/v1",
					api: "openai-completions",
				},
				model: "ad-hoc",
			},
		});
		expect(providerWithDefaultId.statusCode).toBe(200);
		expect(providerWithDefaultId.json()).toMatchObject({
			provider: "draft",
			text: "OK",
		});

		const noTactic = await app.inject({
			method: "POST",
			url: "/api/tactics",
			payload: {},
		});
		expect(noTactic.statusCode).toBe(400);
		expect(noTactic.json()).toEqual({ error: "Tactic payload is required." });

		const noState = await app.inject({
			method: "POST",
			url: "/api/tactics/states",
			payload: {},
		});
		expect(noState.statusCode).toBe(400);
		expect(noState.json()).toEqual({ error: "State payload is required." });

		const noStateUpdate = await app.inject({
			method: "PUT",
			url: "/api/tactics/states/missing",
			payload: {},
		});
		expect(noStateUpdate.statusCode).toBe(400);
		expect(noStateUpdate.json()).toEqual({
			error: "State payload is required.",
		});

		const createdState = await app.inject({
			method: "POST",
			url: "/api/tactics/states",
			payload: {
				state: {
					id: "trust",
					name: "Trust",
					defaultValue: 55,
				},
			},
		});
		expect(createdState.statusCode).toBe(200);
		expect(createdState.json().stateDefinitions).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "trust" })]),
		);

		const updatedState = await app.inject({
			method: "PUT",
			url: "/api/tactics/states/trust",
			payload: {
				state: {
					id: "ignored",
					name: "Trust level",
					defaultValue: 65,
				},
			},
		});
		expect(updatedState.statusCode).toBe(200);
		expect(updatedState.json().stateDefinitions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "trust", name: "Trust level" }),
			]),
		);

		const deletedState = await app.inject({
			method: "DELETE",
			url: "/api/tactics/states/trust",
		});
		expect(deletedState.statusCode).toBe(200);
		expect(deletedState.json().stateDefinitions).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "trust" })]),
		);

		const createdTactic = await app.inject({
			method: "POST",
			url: "/api/tactics",
			payload: {
				tactic: {
					id: "direct",
					name: "Direct",
					keywords: ["direct"],
					emotionRules: [],
					blockedKeywords: [],
					instruction: "Be direct.",
				},
			},
		});
		expect(createdTactic.statusCode).toBe(200);
		expect(createdTactic.json().tactics).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "direct" })]),
		);

		const noUpdate = await app.inject({
			method: "PUT",
			url: "/api/tactics/direct",
			payload: {},
		});
		expect(noUpdate.statusCode).toBe(400);
		expect(noUpdate.json()).toEqual({ error: "Tactic payload is required." });

		const updated = await app.inject({
			method: "PUT",
			url: "/api/tactics/direct",
			payload: {
				tactic: {
					id: "direct",
					name: "Direct updated",
					keywords: ["direct"],
					emotionRules: [],
					blockedKeywords: [],
					instruction: "Stay direct.",
				},
			},
		});
		expect(updated.json().tactics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "direct", name: "Direct updated" }),
			]),
		);

		const deleted = await app.inject({
			method: "DELETE",
			url: "/api/tactics/direct",
		});
		expect(deleted.statusCode).toBe(200);
		expect(deleted.json().tactics).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "direct" })]),
		);

		async function startConversation(
			capabilities = {
				tactics: true,
				dayProgression: false,
				sessionState: false,
				sceneEvents: true,
			},
		) {
			const response = await app.inject({
				method: "POST",
				url: "/api/conversations",
				payload: { title: "Fallback", capabilities, allowedTacticIds: [] },
			});
			return response.json().conversation.id as string;
		}

		async function chat(conversationId: string) {
			const response = await app.inject({
				method: "POST",
				url: "/api/chat",
				payload: { conversationId, message: "hello" },
			});
			expect(response.statusCode).toBe(200);
			return response.json().createdItems as Array<{
				kind: string;
				content: string;
				metadata?: Record<string, unknown>;
			}>;
		}

		expect(await chat(await startConversation())).toMatchObject([
			{ kind: "chat", content: "Plain fallback" },
		]);
		expect(await chat(await startConversation())).toMatchObject([
			{ kind: "chat", content: "{bad}" },
		]);
		expect(await chat(await startConversation())).toMatchObject([
			{ kind: "chat", content: "I could not produce a structured response." },
		]);
		expect(await chat(await startConversation())).toMatchObject([
			{ kind: "chat", content: "I could not produce a structured response." },
		]);
		expect(
			await chat(
				await startConversation({
					tactics: true,
					dayProgression: true,
					sessionState: true,
					sceneEvents: true,
				}),
			),
		).toMatchObject([
			{ kind: "chat", content: "I could not produce a structured response." },
			{ kind: "day_transition", content: "Day 2" },
			{ kind: "scene", content: "Advance scene.", metadata: { day: 2 } },
			{ kind: "scene", content: "Next day scene.", metadata: { day: 2 } },
		]);
		for (
			let attempt = 0;
			attempt < 10 && warn.mock.calls.length === 0;
			attempt += 1
		) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknown error"));
		expect(await chat(await startConversation())).toMatchObject([
			{ kind: "chat", content: "One" },
			{ kind: "chat", content: "Two" },
		]);
		expect(
			await chat(
				await startConversation({
					tactics: true,
					dayProgression: true,
					sessionState: true,
					sceneEvents: true,
				}),
			),
		).toMatchObject([
			{ kind: "chat", content: "Before next day." },
			{ kind: "day_transition", content: "Day rises." },
		]);
		for (
			let attempt = 0;
			attempt < 10 && warn.mock.calls.length < 2;
			attempt += 1
		) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("state failed"));

		await app.close();
	});

	it("keeps provider and usage utility edge cases bounded", async () => {
		const { getProviderAdapter } = await import("../../src/server/providers");
		const { getUsage, logUsage, storeUsage } = await import(
			"../../src/server/services/usageStore"
		);
		const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

		expect(() => getProviderAdapter("missing" as never)).toThrow(
			'Provider API "missing" is not supported.',
		);
		logUsage("empty", {});
		expect(log).toHaveBeenCalledWith(expect.stringContaining("cacheHit=n/a"));

		for (let index = 0; index < 201; index += 1) {
			storeUsage(`request-${index}`, { promptTokens: index });
		}

		expect(getUsage("request-0")).toBeNull();
		expect(getUsage("request-200")).toEqual({ promptTokens: 200 });
	});
});
