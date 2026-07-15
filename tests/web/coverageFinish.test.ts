// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	openAiCompletionsAdapter,
	ProviderRequestError,
} from "../../src/server/providers/openaiCompletions";
import {
	parseStructuredChatResult,
	sanitizeStatePatches,
} from "../../src/shared/domain/runtime";
import type { VioloopConfig } from "../../src/shared/types";
import {
	editLocalLastUserMessage,
	sendLocalChatMessage,
} from "../../src/web/features/chat-session/api/localChat";
import {
	compactLocalConversation,
	generateOpeningScenesLocal,
	resolveProvider,
} from "../../src/web/features/chat-session/api/localRuntime";
import {
	getLocal,
	putLocal,
	resetMemoryDatabase,
	runLocalTransaction,
} from "../../src/web/shared/storage/database";
import {
	exportLocalData,
	serializeExport,
} from "../../src/web/shared/storage/export";
import { importLocalExport } from "../../src/web/shared/storage/exportActions";
import { importLocalData } from "../../src/web/shared/storage/import";
import {
	createLocalConversation,
	getLocalConfigResponse,
	saveLocalTactic,
} from "../../src/web/shared/storage/localData";
import {
	clearAllLocalData,
	getConfig,
	markLocalSeedComplete,
	saveCompactionLocal,
	saveConfig,
	saveSessionClockLocal,
	saveTacticLocal,
	saveTacticRunLocal,
	saveTimelineItemLocal,
} from "../../src/web/shared/storage/repository";
import { workerApp } from "../../src/worker/app";

const config: VioloopConfig = {
	chat: {
		defaultProvider: "local",
		defaultModel: "model-a",
		systemPrompt: "System",
		compaction: { enabled: true, triggerTokens: 1, keepRecentTokens: 1 },
	},
	providers: {
		local: {
			baseUrl: "https://provider.example/v1",
			api: "openai-completions",
			apiKey: "secret",
			models: [{ id: "model-a", name: "Model A" }],
			headers: {
				Accept: "application/json",
				Authorization: "secret",
				"X-Custom": "1",
			},
		},
	},
};

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
				return new Response(JSON.stringify([]), { status: 200 });
			if (url.endsWith("states.json"))
				return new Response(JSON.stringify([]), { status: 200 });
			if (url.endsWith("/api/chat"))
				return new Response(
					JSON.stringify({
						text: JSON.stringify({
							messages: [{ kind: "chat", content: "Answer" }],
							runtimeActions: [
								{ tool: "emit_scene", arguments: { content: "A scene" } },
							],
						}),
						usage: { promptTokens: 1 },
					}),
					{ status: 200 },
				);
			return new Response("missing", { status: 404 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("finish remaining coverage", () => {
	it("covers provider rethrow, stream gaps, and worker header/model filters", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new ProviderRequestError(400, "already typed", "detail");
			}),
		);
		await expect(
			(async () => {
				for await (const _event of openAiCompletionsAdapter.streamChat({
					provider: {
						id: "p",
						name: "P",
						baseUrl: "https://provider.example/v1",
						api: "openai-completions",
						model: { id: "model-a" },
						authHeader: true,
						headers: {},
						compat: {},
					},
					messages: [{ role: "user", content: "hi" }],
					promptBlocks: [],
				})) {
					// drain
				}
			})(),
		).rejects.toMatchObject({ status: 400, message: "already typed" });

		const chunked = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(undefined as unknown as Uint8Array);
				controller.enqueue(
					new TextEncoder().encode(
						`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\n`,
					),
				);
				controller.close();
			},
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(chunked, { status: 200 })),
		);
		const events = [];
		for await (const event of openAiCompletionsAdapter.streamChat({
			provider: {
				id: "p",
				name: "P",
				baseUrl: "https://provider.example/v1",
				api: "openai-completions",
				model: { id: "model-a" },
				authHeader: true,
				headers: {},
				compat: {},
			},
			messages: [{ role: "user", content: "hi" }],
			promptBlocks: [],
		})) {
			events.push(event);
		}
		expect(events).toEqual([{ type: "text", text: "ok" }]);

		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n`,
						{ status: 200 },
					),
			),
		);
		const proxied = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://provider.example/v1",
					api: "openai-completions",
					model: { id: "model-a" },
					models: [{ id: "model-a", name: "Named" }],
					headers: {
						Accept: "text/plain",
						Authorization: "nope",
						"X-Trace": "1",
					},
				},
				messages: [
					{ role: "user", content: "hi" },
					{ role: "tool", content: "bad" },
				],
			}),
		});
		expect(proxied.status).toBe(400);
		const ok = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://provider.example/v1",
					api: "openai-completions",
					model: { id: "model-a" },
					models: [{ id: "model-a", name: "Named" }],
					headers: {
						Accept: "text/plain",
						Authorization: "nope",
						"X-Trace": "1",
					},
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(ok.status).toBe(200);

		const testDenied = await workerApp.request(
			"/api/providers/test",
			{
				method: "POST",
				body: JSON.stringify({
					providerId: "p",
					provider: {
						baseUrl: "https://provider.example/v1",
						api: "openai-completions",
					},
					model: "model-a",
				}),
			},
			{ VIOLOOP_ALLOWED_PROVIDER_HOSTS: "other.example" },
		);
		expect(testDenied.status).toBe(400);
	});

	it("covers parse filter/safeParse failure and clamp branches", () => {
		expect(
			parseStructuredChatResult(
				'{"messages":[{"kind":"chat","content":"Hi"}],"runtimeActions":[{"tool":"noop"},{"tool":"emit_scene"}]}',
			),
		).toMatchObject({
			runtimeActions: [{ tool: "emit_scene" }],
		});
		expect(
			parseStructuredChatResult(
				'{"messages":"bad","runtimeActions":[{"tool":"advance_day"}]}',
			),
		).toEqual({ messages: [] });
		expect(
			sanitizeStatePatches(
				[
					{
						key: "trust",
						value: 10,
						source: "explicit",
						confidence: 1,
						updatedAt: "2026-01-01T00:00:00.000Z",
					},
				],
				[
					{ key: "trust", delta: Number.NaN },
					"raw",
					{ key: "trust", delta: 1 },
				],
			),
		).toEqual([expect.objectContaining({ key: "trust", delta: 0 })]);
	});

	it("covers local chat tactics, scenes, edit edges, and opening day scenes", async () => {
		await saveConfig(config);
		await markLocalSeedComplete();
		await saveTacticLocal({
			id: "calm",
			name: "Calm",
			keywords: ["please"],
			emotionRules: [],
			blockedKeywords: [],
			instruction: "Stay calm.",
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url.endsWith("/api/chat")) {
					return new Response(
						JSON.stringify({
							text: JSON.stringify({
								scenes: ["Opening rain"],
								messages: [{ kind: "chat", content: "Answer" }],
								runtimeActions: [
									{ tool: "emit_scene", arguments: { content: "A scene" } },
								],
							}),
							usage: { promptTokens: 1 },
						}),
						{ status: 200 },
					);
				}
				return new Response("missing", { status: 404 });
			}),
		);
		const created = await createLocalConversation({
			title: "Chat",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: true,
				dayProgression: true,
				sessionState: false,
				sceneEvents: true,
			},
			allowedTacticIds: ["calm"],
			enabledStateIds: [],
		});
		expect(created.timelineItems.some((item) => item.kind === "scene")).toBe(
			true,
		);
		const sent = await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "please help",
		});
		expect(sent.tacticIds).toContain("calm");
		expect(sent.createdItems.some((item) => item.kind === "scene")).toBe(true);
		await expect(
			editLocalLastUserMessage({
				conversationId: created.conversation.id,
				message: "edited please",
			}),
		).resolves.toMatchObject({ conversationId: created.conversation.id });

		const empty = await createLocalConversation({
			title: "Empty",
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
		await expect(
			editLocalLastUserMessage({
				conversationId: empty.conversation.id,
				message: "nope",
			}),
		).rejects.toThrow("No user message");

		await clearAllLocalData();
		await expect(
			sendLocalChatMessage({
				conversationId: created.conversation.id,
				message: "x",
			}),
		).rejects.toThrow();
	});

	it("covers import keep/replace with existing related rows and export skip", async () => {
		await saveConfig(config);
		await markLocalSeedComplete();
		const created = await createLocalConversation({
			title: "Data",
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
		await saveTimelineItemLocal({
			id: "m-existing",
			conversationId: created.conversation.id,
			kind: "chat",
			role: "user",
			content: "hi",
			promptVisibility: "visible",
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		await saveCompactionLocal({
			id: "cmp-existing",
			conversationId: created.conversation.id,
			summary: "sum",
			coveredMessageIds: [],
			tokenEstimate: 1,
			createdAt: "2026-01-01T00:00:00.000Z",
			model: "model-a",
		});
		await saveTacticRunLocal({
			id: "run-existing",
			conversationId: created.conversation.id,
			tacticId: "calm",
			score: 1,
			loaded: true,
			decision: "loaded",
			reason: { reasons: [], matchedKeywords: [], contraindications: [] },
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		await saveSessionClockLocal({
			conversationId: created.conversation.id,
			day: 2,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const exported = await exportLocalData();
		await importLocalData(exported, { strategy: "keep-existing" });
		await importLocalData(
			{
				...exported,
				conversations: exported.conversations.map((entry) => ({
					...entry,
					conversation: { ...entry.conversation, title: "Replaced" },
				})),
			},
			{ strategy: "replace" },
		);
		await importLocalExport(
			new File([serializeExport(exported)], "skip.json", {
				type: "application/json",
			}),
			"skip",
		);
	});

	it("covers empty transactions, seed without config, and malformed JSON sanitize", async () => {
		await runLocalTransaction([]);
		vi.stubGlobal("indexedDB", undefined);
		resetMemoryDatabase();
		await putLocal("meta", { id: "one", value: 1 });
		expect(await getLocal("meta", "one")).toMatchObject({ value: 1 });
		vi.stubGlobal("indexedDB", (await import("fake-indexeddb")).indexedDB);

		await putLocal("meta", {
			id: "seed",
			complete: true,
			seededAt: new Date().toISOString(),
		});
		const getConfigSpy = vi
			.spyOn(
				await import("../../src/web/shared/storage/repository"),
				"getConfig",
			)
			.mockResolvedValueOnce(undefined);
		await expect(getLocalConfigResponse()).rejects.toThrow("unavailable");
		getConfigSpy.mockRestore();

		await saveConfig(config);
		await markLocalSeedComplete();
		await saveLocalTactic(
			{
				id: "trim-me",
				name: " Trim ",
				keywords: [" please ", ""],
				emotionRules: [],
				blockedKeywords: [" no ", ""],
				instruction: " Stay. ",
			},
			null,
		);
		await createLocalConversation({
			title: "All tactics",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: true,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
		});

		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ text: "{not-json}" }), { status: 200 }),
			),
		);
		const created = await createLocalConversation({
			title: "Sanitize",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: false,
				sessionState: false,
				sceneEvents: true,
			},
			allowedTacticIds: [],
			enabledStateIds: [],
		});
		expect(
			await generateOpeningScenesLocal({
				conversation: created.conversation,
				config,
			}),
		).toEqual([]);
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ text: "   " }), { status: 200 }),
			),
		);
		expect(
			await compactLocalConversation({
				conversation: created.conversation,
				config,
				timeline: [
					{
						id: "a",
						conversationId: created.conversation.id,
						kind: "chat",
						role: "user",
						content: "x".repeat(200),
						promptVisibility: "visible",
						createdAt: "2026-01-01T00:00:00.000Z",
					},
					{
						id: "b",
						conversationId: created.conversation.id,
						kind: "chat",
						role: "user",
						content: "y".repeat(200),
						promptVisibility: "visible",
						createdAt: "2026-01-02T00:00:00.000Z",
					},
				],
			}),
		).toBeUndefined();
		expect(resolveProvider(config).headers).toMatchObject({
			Accept: "application/json",
		});
		expect(await getConfig()).toBeTruthy();
		await expect(
			putLocal("meta", {
				id: "bad-clone",
				value: () => "fn",
			}),
		).rejects.toThrow();
	});
});
