import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ActiveProvider,
	ChatProviderAdapter,
	ChatStreamEvent,
	TimelineItem,
	VioloopConfig,
} from "../../src/shared/types";

let dataDir = "";

async function useTempDataDir() {
	dataDir = await mkdtemp(join(tmpdir(), "violoop-compaction-test-"));
	process.env.VIOLOOP_DATA_DIR = dataDir;
	vi.resetModules();
}

function config(
	compaction: VioloopConfig["chat"]["compaction"],
): VioloopConfig {
	return {
		chat: {
			defaultProvider: "local",
			defaultModel: "model-a",
			systemPrompt: "System",
			temperature: 0.2,
			thinkingLevel: "minimal",
			cache: { systemPrompt: true },
			compaction,
		},
		providers: {
			local: {
				baseUrl: "http://provider.test/v1",
				api: "openai-completions",
				models: [{ id: "model-a" }],
			},
		},
	};
}

function provider(): ActiveProvider {
	return {
		id: "local",
		name: "Local",
		baseUrl: "http://provider.test/v1",
		api: "openai-completions",
		model: { id: "model-a" },
		authHeader: false,
		headers: {},
		compat: {},
	};
}

function adapterReturning(
	...events: ChatStreamEvent[]
): ChatProviderAdapter & { calls: unknown[] } {
	const calls: unknown[] = [];
	return {
		calls,
		async *streamChat(options) {
			calls.push(options);
			yield* events;
		},
	};
}

async function conversationWithMessages(contents: string[]) {
	const conversations = await import("../../src/server/conversations");
	const conversation = await conversations.createConversation({
		title: "Compaction",
	});
	for (const [index, content] of contents.entries()) {
		await conversations.appendTimelineItem({
			conversationId: conversation.id,
			kind: "chat",
			role: index % 2 === 0 ? "user" : "assistant",
			content,
			promptVisibility: "visible",
		});
	}
	return conversation;
}

beforeEach(async () => {
	await useTempDataDir();
});

afterEach(async () => {
	delete process.env.VIOLOOP_DATA_DIR;
	await rm(dataDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("conversation compaction", () => {
	it("leaves prompt context untouched when compaction is disabled, below threshold, or has nothing to compact", async () => {
		const { compactConversationIfNeeded } = await import(
			"../../src/server/compaction"
		);
		const conversation = await conversationWithMessages(["short"]);
		const adapter = adapterReturning({ type: "text", text: "summary" });

		const disabled = await compactConversationIfNeeded({
			conversationId: conversation.id,
			config: config({ enabled: false, triggerTokens: 1, keepRecentTokens: 1 }),
			provider: provider(),
			adapter,
		});
		expect(disabled.compacted).toBeUndefined();
		expect(disabled.context.messages).toMatchObject([{ content: "short" }]);

		const belowThreshold = await compactConversationIfNeeded({
			conversationId: conversation.id,
			config: config({
				enabled: true,
				triggerTokens: 10_000,
				keepRecentTokens: 1,
			}),
			provider: provider(),
			adapter,
		});
		expect(belowThreshold.compacted).toBeUndefined();
		expect(belowThreshold.context.messages).toMatchObject([
			{ content: "short" },
		]);

		const nothingOldEnough = await compactConversationIfNeeded({
			conversationId: conversation.id,
			config: config({
				enabled: true,
				triggerTokens: 1,
				keepRecentTokens: 10_000,
			}),
			provider: provider(),
			adapter,
		});
		expect(nothingOldEnough.compacted).toBeUndefined();
		expect(nothingOldEnough.context.messages).toMatchObject([
			{ content: "short" },
		]);
		expect(adapter.calls).toHaveLength(0);
	});

	it("summarizes old visible messages and reloads prompt context around the kept recent tail", async () => {
		const conversations = await import("../../src/server/conversations");
		const { buildCompactionGuidance, compactConversationIfNeeded } =
			await import("../../src/server/compaction");
		const conversation = await conversationWithMessages([]);
		await conversations.appendCompaction({
			conversationId: conversation.id,
			summary: "Previous compact facts",
			firstKeptMessageId: undefined,
			coveredMessageIds: [],
			tokenEstimate: 50,
			model: "model-a",
		});
		for (const content of [
			"A".repeat(120),
			"B".repeat(120),
			"C".repeat(120),
			"D".repeat(120),
		]) {
			await conversations.appendTimelineItem({
				conversationId: conversation.id,
				kind: "chat",
				role: "user",
				content,
				promptVisibility: "visible",
			});
		}
		const adapter = adapterReturning(
			{ type: "usage", usage: { promptTokens: 1 } },
			{ type: "text", text: " Updated compact summary. " },
		);

		const result = await compactConversationIfNeeded({
			conversationId: conversation.id,
			config: config({ enabled: true, triggerTokens: 1, keepRecentTokens: 40 }),
			provider: provider(),
			adapter,
		});

		expect(result.compacted).toMatchObject({
			summary: "Updated compact summary.",
			coveredMessageIds: expect.arrayContaining([expect.any(String)]),
			model: "model-a",
		});
		expect(result.context.summary).toMatchObject({
			summary: "Updated compact summary.",
		});
		expect(result.context.messages.at(-1)?.content).toBe("D".repeat(120));
		expect(adapter.calls[0]).toMatchObject({
			temperature: 0.2,
			thinkingLevel: "minimal",
			cache: { systemPrompt: true },
			promptBlocks: [
				{
					label: "stable-system",
					cacheScope: "stable",
					content: expect.stringContaining("You compact chat history"),
				},
			],
			messages: [
				{
					role: "user",
					content: expect.stringContaining("Previous compact facts"),
				},
			],
		});
		expect(buildCompactionGuidance(result.context.summary)).toContain(
			"Updated compact summary.",
		);
		expect(buildCompactionGuidance(undefined)).toBe("");
	});

	it("falls back to the original context when the summary provider returns empty text", async () => {
		const { compactConversationIfNeeded } = await import(
			"../../src/server/compaction"
		);
		const conversation = await conversationWithMessages([
			"A".repeat(120),
			"B".repeat(120),
		]);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		const result = await compactConversationIfNeeded({
			conversationId: conversation.id,
			config: config({ enabled: true, triggerTokens: 1, keepRecentTokens: 40 }),
			provider: provider(),
			adapter: adapterReturning({ type: "text", text: "   " }),
		});

		expect(result.compacted).toBeUndefined();
		expect(result.context.messages.map((message) => message.content)).toEqual([
			"A".repeat(120),
			"B".repeat(120),
		]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Compaction summary was empty."),
		);
	});

	it("also falls back when the provider throws a non-Error failure value", async () => {
		const { compactConversationIfNeeded } = await import(
			"../../src/server/compaction"
		);
		const conversation = await conversationWithMessages([
			"A".repeat(120),
			"B".repeat(120),
		]);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const adapter: ChatProviderAdapter = {
			async *streamChat() {
				yield* [];
				throw "provider offline";
			},
		};

		const result = await compactConversationIfNeeded({
			conversationId: conversation.id,
			config: config({ enabled: true, triggerTokens: 1, keepRecentTokens: 40 }),
			provider: provider(),
			adapter,
		});

		expect(result.compacted).toBeUndefined();
		expect(result.context.messages).toHaveLength(2);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknown error"));
	});

	it("formats only real chat turns into provider messages", async () => {
		const { toChatMessages } = await import("../../src/server/compaction");
		const items: TimelineItem[] = [
			timeline("chat", "user", "Hello"),
			timeline("chat", "assistant", "Hi"),
			timeline("chat", "system", "Internal note"),
			timeline("day_transition", "system", "Day 2"),
			timeline("scene", "system", "Rain at the window."),
			timeline("state_update", "system", "State changed."),
		];

		expect(toChatMessages(items)).toEqual([
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi" },
		]);
	});

	it("schedules at most one background compaction per conversation", async () => {
		const conversations = await import("../../src/server/conversations");
		const { scheduleConversationCompaction } = await import(
			"../../src/server/compaction"
		);
		const conversation = await conversationWithMessages([
			"A".repeat(120),
			"B".repeat(120),
		]);
		let release: (() => void) | undefined;
		const calls: unknown[] = [];
		const adapter: ChatProviderAdapter & { calls: unknown[] } = {
			calls,
			async *streamChat(options) {
				calls.push(options);
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				yield { type: "text", text: "Queued summary" };
			},
		};

		const input = {
			conversationId: conversation.id,
			config: config({ enabled: true, triggerTokens: 1, keepRecentTokens: 40 }),
			provider: provider(),
			adapter,
		};
		scheduleConversationCompaction(input);
		scheduleConversationCompaction(input);
		await waitFor(() => calls.length === 1);
		release?.();
		await waitFor(async () => {
			const context = await conversations.loadPromptContext(conversation.id);
			return context.summary?.summary === "Queued summary";
		});

		expect(calls).toHaveLength(1);
	});

	it("logs background compaction scheduler failures without surfacing them", async () => {
		const { scheduleConversationCompaction } = await import(
			"../../src/server/compaction"
		);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		scheduleConversationCompaction({
			conversationId: "broken",
			config: undefined as never,
			provider: provider(),
			adapter: adapterReturning(),
		});
		await waitFor(() => warn.mock.calls.length > 0);

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("[compaction] conversation=broken skipped:"),
		);

		scheduleConversationCompaction({
			conversationId: "raw-failure",
			config: {
				get chat() {
					throw "raw failure";
				},
			} as never,
			provider: provider(),
			adapter: adapterReturning(),
		});
		await waitFor(() => warn.mock.calls.length > 1);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(
				"[compaction] conversation=raw-failure skipped: unknown error",
			),
		);
	});
});

async function waitFor(check: () => boolean | Promise<boolean>) {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (await check()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("Timed out waiting for condition.");
}

function timeline(
	kind: TimelineItem["kind"],
	role: TimelineItem["role"],
	content: string,
): TimelineItem {
	return {
		id: `${kind}-${role}`,
		conversationId: "c",
		kind,
		role,
		content,
		promptVisibility: "visible",
		createdAt: "2026-01-01T00:00:00.000Z",
	};
}
