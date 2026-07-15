// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredCompaction, TimelineItem } from "../../src/shared/types";
import { createClientId } from "../../src/web/shared/lib";
import {
	getLocal,
	listLocal,
	openVioloopDatabase,
	putLocal,
	resetMemoryDatabase,
	runLocalTransaction,
} from "../../src/web/shared/storage/database";
import {
	clearAllLocalData,
	deleteConversationLocal,
	getSessionTacticIdsLocal,
	getUsageLocal,
	listConversationsLocal,
	listTacticRunsLocal,
	replaceConversationTimelineLocal,
	saveCompactionLocal,
	saveConversationLocal,
	saveSessionTacticIdsLocal,
	saveTacticRunLocal,
	saveTimelineItemLocal,
	saveUsageLocal,
} from "../../src/web/shared/storage/repository";
import { stubLocalSeedFetch } from "./localStorageHelpers";

beforeEach(async () => {
	await clearAllLocalData();
	resetMemoryDatabase();
	stubLocalSeedFetch();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("local id generation", () => {
	it("falls back to a timestamp-based id when Web Crypto's randomUUID is unavailable", () => {
		vi.stubGlobal("crypto", {});
		const id = createClientId("widget");
		expect(id).toMatch(/^widget-[a-z0-9]+-[a-z0-9]+$/);
	});
});

type FakeIdbRequest = {
	result?: unknown;
	onsuccess?: () => void;
	onerror?: () => void;
	onupgradeneeded?: () => void;
	transaction?: {
		objectStore: (name: string) => { put: (value: unknown) => void };
	};
};
type FakeIdbTransaction = {
	objectStore: (name: string) => {
		get?: () => FakeIdbRequest;
		getAll?: () => FakeIdbRequest;
		put?: () => void;
		delete?: () => void;
		clear?: () => void;
	};
	oncomplete?: () => void;
	onerror?: () => void;
	onabort?: () => void;
};

function fakeIndexedDb(open: () => FakeIdbRequest & { result?: unknown }) {
	return { open } as unknown as IDBFactory;
}

describe("IndexedDB failure paths", () => {
	it("surfaces a failure to open the local database", async () => {
		vi.stubGlobal(
			"indexedDB",
			fakeIndexedDb(() => {
				const request: FakeIdbRequest = {};
				queueMicrotask(() => request.onerror?.());
				return request;
			}),
		);
		await expect(openVioloopDatabase()).rejects.toThrow(
			"Unable to open local database.",
		);
	});

	it("surfaces a failed read request", async () => {
		vi.stubGlobal(
			"indexedDB",
			fakeIndexedDb(() => {
				const opened: FakeIdbRequest = {
					result: {
						transaction(): FakeIdbTransaction {
							const tx: FakeIdbTransaction = {
								objectStore: () => ({
									get: () => {
										const req: FakeIdbRequest = {};
										queueMicrotask(() => req.onerror?.());
										return req;
									},
								}),
							};
							return tx;
						},
					},
				};
				queueMicrotask(() => opened.onsuccess?.());
				return opened;
			}),
		);
		await expect(getLocal("meta", "seed")).rejects.toThrow(
			"Local database request failed.",
		);
	});

	it("surfaces a read transaction failure even when no request error fires", async () => {
		vi.stubGlobal(
			"indexedDB",
			fakeIndexedDb(() => {
				const opened: FakeIdbRequest = {
					result: {
						transaction(): FakeIdbTransaction {
							const tx: FakeIdbTransaction = {
								objectStore: () => ({
									getAll: () => ({}),
								}),
							};
							queueMicrotask(() => tx.onerror?.());
							return tx;
						},
					},
				};
				queueMicrotask(() => opened.onsuccess?.());
				return opened;
			}),
		);
		await expect(listLocal("meta")).rejects.toThrow(
			"Local database transaction failed.",
		);
	});

	it("surfaces a failed write transaction", async () => {
		vi.stubGlobal(
			"indexedDB",
			fakeIndexedDb(() => {
				const opened: FakeIdbRequest = {
					result: {
						transaction(): FakeIdbTransaction {
							const tx: FakeIdbTransaction = {
								objectStore: () => ({
									put: () => {},
									delete: () => {},
									clear: () => {},
								}),
							};
							queueMicrotask(() => tx.onerror?.());
							return tx;
						},
					},
				};
				queueMicrotask(() => opened.onsuccess?.());
				return opened;
			}),
		);
		await expect(putLocal("meta", { id: "one", value: true })).rejects.toThrow(
			"Local database transaction failed.",
		);
	});

	it("skips creating object stores that already exist during a schema upgrade", async () => {
		const existingStores = new Set(["meta"]);
		vi.stubGlobal(
			"indexedDB",
			fakeIndexedDb(() => {
				const database = {
					objectStoreNames: {
						contains: (name: string) => existingStores.has(name),
					},
					createObjectStore: (name: string) => {
						existingStores.add(name);
					},
				};
				const request: FakeIdbRequest = {
					result: database,
					transaction: { objectStore: () => ({ put: () => {} }) },
				};
				queueMicrotask(() => {
					request.onupgradeneeded?.();
					request.onsuccess?.();
				});
				return request;
			}),
		);
		const database = await openVioloopDatabase();
		expect(existingStores.has("meta")).toBe(true);
		expect(existingStores.has("tactics")).toBe(true);
		expect(database).toBeTruthy();
	});

	it("resolves an empty list when a memory-mode store was never populated", async () => {
		vi.stubGlobal("indexedDB", undefined);
		resetMemoryDatabase();
		expect(await listLocal("tacticRuns")).toEqual([]);
	});

	it("rolls back an in-memory transaction when an operation throws and resolves missing keys to a default", async () => {
		vi.stubGlobal("indexedDB", undefined);
		resetMemoryDatabase();
		await putLocal("meta", { id: "keep", value: 1 });
		const poisoned = new Proxy(
			{},
			{
				has() {
					throw new Error("boom");
				},
			},
		);
		await expect(
			runLocalTransaction([
				{ type: "put", storeName: "meta", value: { id: "keep", value: 2 } },
				{ type: "put", storeName: "meta", value: poisoned },
			]),
		).rejects.toThrow("boom");
		expect(await getLocal("meta", "keep")).toMatchObject({ value: 1 });

		await putLocal("meta", {} as unknown as { id: string });
		expect(await getLocal("meta", "current")).toEqual({});

		await expect(runLocalTransaction([])).resolves.toBeUndefined();
	});
});

describe("repository primitives", () => {
	it("writes timeline items, compactions, and usage records directly and reads them back", async () => {
		await clearAllLocalData();
		const conversation = {
			id: "conv-1",
			title: "Direct",
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
		};
		await saveConversationLocal(conversation);
		const item: TimelineItem = {
			id: "item-1",
			conversationId: conversation.id,
			kind: "chat",
			role: "user",
			content: "hi",
			promptVisibility: "visible",
			createdAt: "2026-01-01T00:00:00.000Z",
		};
		await saveTimelineItemLocal(item);
		const compaction: StoredCompaction = {
			id: "compaction-1",
			conversationId: conversation.id,
			summary: "summary",
			coveredMessageIds: [item.id],
			tokenEstimate: 10,
			createdAt: "2026-01-01T00:00:00.000Z",
			model: "model-a",
		};
		await saveCompactionLocal(compaction);
		await saveUsageLocal("request-1", { promptTokens: 5 }, conversation.id);
		await saveUsageLocal("request-without-conversation", { promptTokens: 1 });
		expect(await getUsageLocal("request-without-conversation")).toMatchObject({
			promptTokens: 1,
		});
		await saveTacticRunLocal({
			id: "run-1",
			conversationId: conversation.id,
			messageId: null,
			tacticId: "calm",
			score: 1,
			loaded: true,
			decision: "loaded",
			reason: { reasons: [], matchedKeywords: [], contraindications: [] },
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		expect(await getUsageLocal("request-1")).toMatchObject({
			promptTokens: 5,
		});
		expect(
			await replaceConversationTimelineLocal(conversation, [
				{ ...item, content: "replaced" },
			]),
		).toBeUndefined();

		await saveConversationLocal({ ...conversation, id: "conv-0" });
		await saveConversationLocal({
			...conversation,
			id: "conv-2",
			updatedAt: "2026-02-01T00:00:00.000Z",
		});
		const list = await listConversationsLocal();
		expect(list[0]?.id).toBe("conv-2");

		expect(await getSessionTacticIdsLocal("missing-conversation")).toEqual([]);
		await saveSessionTacticIdsLocal(conversation.id, ["calm"]);
		expect(await listTacticRunsLocal(conversation.id)).toHaveLength(1);
		await deleteConversationLocal(conversation.id);
		expect(await getSessionTacticIdsLocal(conversation.id)).toEqual([]);
		expect(await listTacticRunsLocal(conversation.id)).toEqual([]);
	});
});
