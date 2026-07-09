import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ActiveProvider,
	ChatProviderAdapter,
	ChatStreamEvent,
	VioloopConfig,
} from "../../src/shared/types";

let dataDir = "";

async function useTempDataDir() {
	dataDir = await mkdtemp(join(tmpdir(), "violoop-runtime-test-"));
	process.env.VIOLOOP_DATA_DIR = dataDir;
	vi.resetModules();
}

function config(): VioloopConfig {
	return {
		chat: {
			defaultProvider: "local",
			defaultModel: "model-a",
			systemPrompt: "System",
			temperature: 0.4,
			thinkingLevel: "high",
			cache: { systemPrompt: true },
			compaction: { enabled: true, triggerTokens: 1000, keepRecentTokens: 100 },
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

beforeEach(async () => {
	await useTempDataDir();
});

afterEach(async () => {
	delete process.env.VIOLOOP_DATA_DIR;
	await rm(dataDir, { recursive: true, force: true });
	vi.restoreAllMocks();
});

describe("session runtime", () => {
	it("creates a day-one opening timeline with model-generated scene narration", async () => {
		const conversations = await import("../../src/server/conversations");
		const runtime = await import("../../src/server/runtime");
		const conversation = await conversations.createConversation({
			title: "Opening",
			profile: {
				assistantName: "Ava",
				userRole: "Visitor",
				assistantRole: "Host",
			},
		});
		const adapter = adapterReturning(
			{ type: "usage", usage: { promptTokens: 1 } },
			{
				type: "text",
				text: 'prefix {"scenes":["  The room is quiet.\\nA screen waits.  ","Second scene","ignored third"]} suffix',
			},
		);

		const items = await runtime.createOpeningTimeline({
			conversation,
			config: config(),
			provider: provider(),
			adapter,
		});

		expect(items.map((item) => [item.kind, item.role, item.content])).toEqual([
			["day_transition", "system", "Day 1"],
			["scene", "system", "The room is quiet. A screen waits."],
			["scene", "system", "Second scene"],
		]);
		await expect(
			conversations.getSessionClock(conversation.id),
		).resolves.toMatchObject({ day: 1 });
		expect(adapter.calls).toHaveLength(1);
		expect(adapter.calls[0]).toMatchObject({
			temperature: 0.4,
			thinkingLevel: "high",
			cache: { systemPrompt: true },
			messages: [
				{
					role: "user",
					content: expect.stringContaining('"assistantDisplayName":"Ava"'),
				},
			],
		});
	});

	it("keeps the day-one transition even when the opening scene model returns unusable JSON", async () => {
		const conversations = await import("../../src/server/conversations");
		const runtime = await import("../../src/server/runtime");
		const conversation = await conversations.createConversation({
			title: "Invalid opening",
		});
		const adapter = adapterReturning({ type: "text", text: "not json" });

		const items = await runtime.createOpeningTimeline({
			conversation,
			config: config(),
			provider: provider(),
			adapter,
		});

		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			kind: "day_transition",
			content: "Day 1",
		});
	});

	it("reuses an existing session clock and skips state updates already done for the current day", async () => {
		const conversations = await import("../../src/server/conversations");
		const runtime = await import("../../src/server/runtime");
		const conversation = await conversations.createConversation({
			title: "Clock",
		});
		await conversations.setSessionClock({
			conversationId: conversation.id,
			day: 3,
			stateUpdatedDay: 3,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const adapter = adapterReturning({ type: "text", text: "{}" });

		await expect(
			runtime.ensureSessionClock(conversation.id),
		).resolves.toMatchObject({ day: 3, stateUpdatedDay: 3 });
		await runtime.runDailyStateUpdate({
			conversationId: conversation.id,
			config: config(),
			provider: provider(),
			adapter,
		});

		expect(adapter.calls).toHaveLength(0);
		expect(await conversations.listTimelineItems(conversation.id)).toEqual([]);
	});

	it("updates session state once per day with bounded model deltas and records a hidden audit item", async () => {
		const conversations = await import("../../src/server/conversations");
		const tactics = await import("../../src/server/tactics");
		const runtime = await import("../../src/server/runtime");
		const conversation = await conversations.createConversation({
			title: "State",
		});
		await conversations.setSessionClock({
			conversationId: conversation.id,
			day: 2,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		await conversations.appendTimelineItem({
			conversationId: conversation.id,
			kind: "chat",
			role: "user",
			content: "Yesterday got tense.",
			promptVisibility: "visible",
		});
		await tactics.setUserState(conversation.id, [
			{
				key: "urgency",
				value: 95,
				source: "inferred",
				confidence: 0.2,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
			{
				key: "frustration",
				value: 5,
				source: "inferred",
				confidence: 0.2,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
			{
				key: "confidence-needed",
				value: 50,
				source: "inferred",
				confidence: 0.2,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
			{
				key: "detail-tolerance",
				value: 50,
				source: "inferred",
				confidence: 0.2,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		const adapter = adapterReturning(
			{ type: "usage", usage: { promptTokens: 1 } },
			{
				type: "text",
				text: JSON.stringify({
					patches: [
						{ key: "urgency", delta: 99, reason: "more urgent" },
						{ key: "urgency", delta: -10, reason: "duplicate ignored" },
						{ key: "frustration", delta: -99, reason: "calmed down" },
						{ key: "not_allowed", delta: 9, reason: "ignored" },
						{ key: "detail-tolerance", delta: "bad", reason: "non finite" },
						{ key: "confidence-needed", delta: 1, reason: null },
					],
					stateNote: "   ",
				}),
			},
		);

		await runtime.runDailyStateUpdate({
			conversationId: conversation.id,
			config: config(),
			provider: provider(),
			adapter,
		});

		const states = await tactics.listUserState(conversation.id);
		expect(states).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "urgency",
					value: 100,
					source: "observed",
					confidence: 0.75,
				}),
				expect.objectContaining({
					key: "frustration",
					value: 0,
					source: "observed",
					confidence: 0.75,
				}),
				expect.objectContaining({
					key: "detail-tolerance",
					value: 50,
					source: "observed",
					confidence: 0.75,
				}),
				expect.objectContaining({
					key: "confidence-needed",
					value: 51,
					source: "observed",
					confidence: 0.75,
				}),
			]),
		);
		await expect(
			conversations.getSessionClock(conversation.id),
		).resolves.toMatchObject({ day: 2, stateUpdatedDay: 2 });
		const audit = (await conversations.listTimelineItems(conversation.id)).find(
			(item) => item.kind === "state_update",
		);
		expect(audit).toMatchObject({
			promptVisibility: "hidden",
			content: "Day 2 state updated after day transition.",
			metadata: {
				day: 2,
				patches: [
					{
						key: "urgency",
						previousValue: 95,
						nextValue: 100,
						delta: 10,
						reason: "more urgent",
					},
					{
						key: "frustration",
						previousValue: 5,
						nextValue: 0,
						delta: -10,
						reason: "calmed down",
					},
					{
						key: "detail-tolerance",
						previousValue: 50,
						nextValue: 50,
						delta: 0,
						reason: "non finite",
					},
					{
						key: "confidence-needed",
						previousValue: 50,
						nextValue: 51,
						delta: 1,
						reason: "",
					},
				],
			},
		});
	});

	it("falls back to no runtime changes when the state model does not return JSON", async () => {
		const conversations = await import("../../src/server/conversations");
		const runtime = await import("../../src/server/runtime");
		const conversation = await conversations.createConversation({
			title: "Bad JSON",
		});
		await conversations.setSessionClock({
			conversationId: conversation.id,
			day: 4,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const adapter = adapterReturning({ type: "text", text: "{bad json" });

		await runtime.runDailyStateUpdate({
			conversationId: conversation.id,
			config: config(),
			provider: provider(),
			adapter,
		});

		const audit = (await conversations.listTimelineItems(conversation.id)).find(
			(item) => item.kind === "state_update",
		);
		expect(audit).toMatchObject({
			content: "Day 4 state updated after day transition.",
			metadata: { day: 4, patches: [] },
		});
	});

	it("ignores non-array patches and patches whose state does not exist in the session", async () => {
		const conversations = await import("../../src/server/conversations");
		const tactics = await import("../../src/server/tactics");
		const runtime = await import("../../src/server/runtime");
		const conversation = await conversations.createConversation({
			title: "Sparse state",
		});
		await conversations.setSessionClock({
			conversationId: conversation.id,
			day: 5,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		await tactics.setUserState(conversation.id, [
			{
				key: "urgency",
				value: 10,
				source: "inferred",
				confidence: 0.2,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		]);

		await runtime.runDailyStateUpdate({
			conversationId: conversation.id,
			config: config(),
			provider: provider(),
			adapter: adapterReturning({
				type: "text",
				text: '{"patches":{},"stateNote":"No array patches"}',
			}),
		});
		expect(
			(await conversations.listTimelineItems(conversation.id)).at(-1),
		).toMatchObject({
			kind: "state_update",
			content: "No array patches",
			metadata: { patches: [] },
		});

		await runtime.advanceDay(conversation.id, 5, undefined);
		await runtime.runDailyStateUpdate({
			conversationId: conversation.id,
			config: config(),
			provider: provider(),
			adapter: adapterReturning({
				type: "text",
				text: '{"patches":[{"key":"frustration","delta":3}],"stateNote":"Missing state ignored"}',
			}),
		});
		expect(
			(await conversations.listTimelineItems(conversation.id)).at(-1),
		).toMatchObject({
			kind: "state_update",
			content: "Missing state ignored",
			metadata: { patches: [] },
		});

		await runtime.advanceDay(conversation.id, 6, undefined);
		await runtime.runDailyStateUpdate({
			conversationId: conversation.id,
			config: config(),
			provider: provider(),
			adapter: adapterReturning({
				type: "text",
				text: '{"patches":[{"key":"urgency","delta":1}],"stateNote":"Reason omitted"}',
			}),
		});
		expect(
			(await conversations.listTimelineItems(conversation.id)).at(-1),
		).toMatchObject({
			kind: "state_update",
			content: "Reason omitted",
			metadata: {
				patches: [
					{
						key: "urgency",
						previousValue: 10,
						nextValue: 11,
						delta: 1,
						reason: "",
					},
				],
			},
		});
	});

	it("treats malformed JSON objects from opening and state models as empty model decisions", async () => {
		const conversations = await import("../../src/server/conversations");
		const runtime = await import("../../src/server/runtime");
		const opening = await conversations.createConversation({
			title: "Opening bad object",
		});
		await expect(
			runtime.createOpeningTimeline({
				conversation: opening,
				config: config(),
				provider: provider(),
				adapter: adapterReturning({ type: "text", text: "{bad}" }),
			}),
		).resolves.toHaveLength(1);

		const state = await conversations.createConversation({
			title: "State bad object",
		});
		await conversations.setSessionClock({
			conversationId: state.id,
			day: 7,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		await runtime.runDailyStateUpdate({
			conversationId: state.id,
			config: config(),
			provider: provider(),
			adapter: adapterReturning({ type: "text", text: "{bad}" }),
		});
		expect(
			(await conversations.listTimelineItems(state.id)).at(-1),
		).toMatchObject({
			kind: "state_update",
			metadata: { patches: [] },
		});
	});

	it("advances the session day with either model text or a deterministic fallback", async () => {
		const conversations = await import("../../src/server/conversations");
		const runtime = await import("../../src/server/runtime");
		const conversation = await conversations.createConversation({
			title: "Advance",
		});

		await expect(
			runtime.advanceDay(conversation.id, 1, "  Morning breaks.  "),
		).resolves.toMatchObject({
			kind: "day_transition",
			content: "Morning breaks.",
			metadata: { day: 2 },
		});
		await expect(
			conversations.getSessionClock(conversation.id),
		).resolves.toMatchObject({ day: 2 });
		await expect(
			runtime.advanceDay(conversation.id, 2, "  "),
		).resolves.toMatchObject({
			kind: "day_transition",
			content: "Day 3",
			metadata: { day: 3 },
		});
	});
});
