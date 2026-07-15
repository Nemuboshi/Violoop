// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyStatePatchValues,
	sanitizeStatePatches,
} from "../../src/shared/domain/runtime";
import type { VioloopConfig } from "../../src/shared/types";
import { sendLocalChatMessage } from "../../src/web/features/chat-session/api/localChat";
import { resolveProvider } from "../../src/web/features/chat-session/api/localRuntime";
import { createLocalOpeningTimeline } from "../../src/web/features/chat-session/api/openingTimeline";
import {
	putLocal,
	resetMemoryDatabase,
	runLocalTransaction,
} from "../../src/web/shared/storage/database";
import { exportLocalData } from "../../src/web/shared/storage/export";
import { importLocalData } from "../../src/web/shared/storage/import";
import {
	createLocalConversation,
	getLocalConfigResponse,
} from "../../src/web/shared/storage/localData";
import * as repository from "../../src/web/shared/storage/repository";
import {
	appendLocalItemsAtomic,
	clearAllLocalData,
	deleteConversationLocal,
	getSessionTacticIdsLocal,
	listCompactionsLocal,
	saveCompactionLocal,
	saveConfig,
	saveConversationLocal,
	saveTacticRunLocal,
	saveTimelineItemLocal,
} from "../../src/web/shared/storage/repository";
import { workerApp } from "../../src/worker/app";

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
			models: [{ id: "other" }],
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
							messages: [{ kind: "chat", content: "Ok" }],
						}),
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

describe("final branch coverage", () => {
	it("covers remaining runtime, repository, import, worker, and chat edges", async () => {
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
					{ key: 123, delta: 1 },
					{ key: "trust", delta: 1 },
				],
			),
		).toEqual([expect.objectContaining({ key: "trust", delta: 1 })]);
		expect(
			sanitizeStatePatches([], [undefined, null, 1, { key: "x" }]),
		).toEqual([]);
		expect(
			applyStatePatchValues(
				[
					{
						key: "trust",
						value: 10,
						source: "explicit",
						confidence: 1,
						updatedAt: "2026-01-01T00:00:00.000Z",
					},
				],
				[{ key: "trust", delta: Number.POSITIVE_INFINITY }],
			),
		).toHaveLength(1);

		vi.stubGlobal("indexedDB", undefined);
		resetMemoryDatabase();
		await runLocalTransaction([
			{ type: "put", storeName: "meta", value: { label: "no-id" } },
		]);
		vi.stubGlobal("indexedDB", (await import("fake-indexeddb")).indexedDB);
		await putLocal("meta", { id: "seed", value: true });

		vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
			const tx = {
				objectStore: () => ({
					put: () => ({}),
					delete: () => ({}),
					clear: () => ({}),
					get: () => {
						const request = {
							onsuccess: null as ((event: Event) => void) | null,
							onerror: null as ((event: Event) => void) | null,
							result: undefined,
							error: null as DOMException | null,
						};
						queueMicrotask(() => {
							request.error = new DOMException("forced get");
							request.onerror?.(new Event("error"));
						});
						return request;
					},
					getAll: () => {
						const request = {
							onsuccess: null as ((event: Event) => void) | null,
							onerror: null as ((event: Event) => void) | null,
							result: [],
							error: null as DOMException | null,
						};
						queueMicrotask(() => {
							request.error = new DOMException("forced getAll");
							request.onerror?.(new Event("error"));
						});
						return request;
					},
				}),
				oncomplete: null as ((event: Event) => void) | null,
				onerror: null as ((event: Event) => void) | null,
				onabort: null as ((event: Event) => void) | null,
				error: null as DOMException | null,
			};
			queueMicrotask(() => {
				tx.error = new DOMException("forced tx");
				tx.onerror?.(new Event("error"));
			});
			return tx as unknown as IDBTransaction;
		});
		await expect(
			putLocal("meta", { id: "fail-put", value: 1 }),
		).rejects.toThrow("Local database");
		await expect(
			(await import("../../src/web/shared/storage/database")).getLocal(
				"meta",
				"x",
			),
		).rejects.toThrow("Local database");
		vi.mocked(IDBDatabase.prototype.transaction).mockRestore();

		await saveConfig(config);
		const created = await createLocalConversation({
			title: "Final",
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
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							text: JSON.stringify({ scenes: ["Only scene"] }),
						}),
						{ status: 200 },
					),
			),
		);
		const opening = await createLocalOpeningTimeline(created.conversation);
		expect(opening[0]?.metadata).toBeUndefined();

		expect(await getSessionTacticIdsLocal("missing")).toEqual([]);
		expect(resolveProvider(config).model.id).toBe("model-a");

		await saveTimelineItemLocal({
			id: "t1",
			conversationId: created.conversation.id,
			kind: "chat",
			role: "user",
			content: "a",
			promptVisibility: "visible",
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		await saveTimelineItemLocal({
			id: "t2",
			conversationId: created.conversation.id,
			kind: "chat",
			role: "user",
			content: "b",
			promptVisibility: "visible",
			createdAt: "2026-01-02T00:00:00.000Z",
		});
		await saveCompactionLocal({
			id: "c1",
			conversationId: created.conversation.id,
			summary: "one",
			coveredMessageIds: [],
			tokenEstimate: 1,
			createdAt: "2026-01-01T00:00:00.000Z",
			model: "model-a",
		});
		await saveCompactionLocal({
			id: "c2",
			conversationId: created.conversation.id,
			summary: "two",
			coveredMessageIds: [],
			tokenEstimate: 1,
			createdAt: "2026-01-02T00:00:00.000Z",
			model: "model-a",
		});
		expect(await listCompactionsLocal(created.conversation.id)).toHaveLength(2);
		await saveTacticRunLocal({
			id: "r1",
			conversationId: created.conversation.id,
			tacticId: "calm",
			score: 1,
			loaded: true,
			decision: "loaded",
			reason: { reasons: [], matchedKeywords: [], contraindications: [] },
			createdAt: "2026-01-02T00:00:00.000Z",
		});
		await appendLocalItemsAtomic(
			created.conversation,
			[
				{
					id: "hidden",
					conversationId: created.conversation.id,
					kind: "state_update",
					role: "system",
					content: "hidden",
					promptVisibility: "hidden",
					createdAt: "2026-01-03T00:00:00.000Z",
				},
			],
			undefined,
			{},
		);
		await deleteConversationLocal(created.conversation.id);

		const exported = await exportLocalData();
		await importLocalData({ ...exported, usage: undefined });
		await expect(
			importLocalData({
				...exported,
				config: undefined as never,
			}),
		).resolves.toBeTruthy();

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
								messages: [{ kind: "chat", content: "Ok" }],
							}),
						}),
						{ status: 200 },
					);
				return new Response("missing", { status: 404 });
			}),
		);
		const getConfigSpy = vi
			.spyOn(repository, "getConfig")
			.mockResolvedValue(undefined);
		await saveConversationLocal({
			id: "orphan",
			title: "Orphan",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			messageCount: 0,
		});
		await expect(
			sendLocalChatMessage({ conversationId: "orphan", message: "hi" }),
		).rejects.toThrow("unavailable");
		getConfigSpy.mockRestore();

		const badMessage = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://provider.example/v1",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [null, { role: "user" }],
			}),
		});
		expect(badMessage.status).toBe(400);

		const privateLinkLocal = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://169.254.10.10/v1",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(privateLinkLocal.status).toBe(400);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw Object.assign(new Error(""), {
					status: 503,
					detail: "empty-message",
				});
			}),
		);
		const emptyMessage = await workerApp.request("/api/providers/test", {
			method: "POST",
			body: JSON.stringify({
				providerId: "draft-id",
				provider: {
					baseUrl: "https://provider.example/v1",
					api: "openai-completions",
				},
				model: "m",
			}),
		});
		expect(emptyMessage.status).toBe(503);
		expect(await emptyMessage.json()).toMatchObject({
			error: "Unexpected server error",
			detail: "empty-message",
		});
		vi.spyOn(repository, "getConfig").mockResolvedValueOnce(undefined);
		await putLocal("meta", {
			id: "seed",
			complete: true,
			seededAt: new Date().toISOString(),
		});
		await expect(getLocalConfigResponse()).rejects.toThrow("unavailable");
	});
});
