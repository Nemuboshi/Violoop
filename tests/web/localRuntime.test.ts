// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VioloopConfig } from "../../src/shared/types";
import { createLocalConversation } from "../../src/web/features/chat-session/api/createLocalConversation";
import {
	callWorker,
	compactLocalConversation,
	generateOpeningScenesLocal,
	listLocalTacticRuns,
	resolveProvider,
	runDailyStateUpdateLocal,
	selectLocalTactics,
} from "../../src/web/features/chat-session/api/localRuntime";
import {
	clearAllLocalData,
	getSessionClockLocal,
	markLocalSeedComplete,
	saveConfig,
	saveStateDefinitionLocal,
	saveTacticLocal,
} from "../../src/web/shared/storage/repository";
import { createVioloopConfig } from "../fixtures/config";

const config: VioloopConfig = createVioloopConfig({
	chat: {
		compaction: { enabled: true, triggerTokens: 1, keepRecentTokens: 1 },
	},
});

function chatResponse(text: string) {
	return new Response(JSON.stringify({ text, usage: { promptTokens: 1 } }), {
		status: 200,
	});
}

beforeEach(async () => {
	await clearAllLocalData();
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => chatResponse('{"scenes":["Opening scene"]}')),
	);
	await saveConfig(config);
	await markLocalSeedComplete();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("local runtime workflows", () => {
	it("selects tactics, limits winners, and records runs", async () => {
		for (let index = 0; index < 6; index += 1) {
			await saveTacticLocal({
				id: `tactic-${index}`,
				name: `Tactic ${index}`,
				keywords: ["please"],
				emotionRules: [],
				blockedKeywords: [],
				instruction: `Instruction ${index}`,
			});
		}
		const withTactics = await createLocalConversation({
			title: "Tactics",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: true,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
			allowedTacticIds: Array.from(
				{ length: 6 },
				(_, index) => `tactic-${index}`,
			),
			enabledStateIds: [],
		});
		const selection = await selectLocalTactics({
			conversationId: withTactics.conversation.id,
			message: "please help",
			messageId: "m1",
		});
		expect(selection.loaded.length).toBeLessThanOrEqual(5);
		expect(selection.runs.length).toBe(6);
		expect(await listLocalTacticRuns(withTactics.conversation.id)).toHaveLength(
			6,
		);
	});

	it("generates opening scenes and compacts long conversations", async () => {
		const created = await createLocalConversation({
			title: "Scenes",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: true,
				sessionState: false,
				sceneEvents: true,
			},
			allowedTacticIds: [],
			enabledStateIds: [],
		});
		const scenes = await generateOpeningScenesLocal({
			conversation: created.conversation,
			config,
		});
		expect(scenes).toEqual(["Opening scene"]);
		const timeline = Array.from({ length: 3 }, (_, index) => ({
			id: `m${index}`,
			conversationId: created.conversation.id,
			kind: "chat" as const,
			role: "user" as const,
			content: "x".repeat(200),
			promptVisibility: "visible" as const,
			createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
		}));
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => chatResponse("compacted summary")),
		);
		const compaction = await compactLocalConversation({
			conversation: created.conversation,
			config,
			timeline,
		});
		expect(compaction?.summary).toBe("compacted summary");
	});

	it("runs daily state updates once per day and resolves providers", async () => {
		await saveStateDefinitionLocal({
			id: "trust",
			name: "Trust",
			defaultValue: 45,
		});
		const created = await createLocalConversation({
			title: "State",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: true,
				sessionState: true,
				sceneEvents: false,
			},
			allowedTacticIds: [],
			enabledStateIds: ["trust"],
		});
		const clock = await getSessionClockLocal(created.conversation.id);
		if (!clock) throw new Error("Expected session clock.");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				chatResponse(
					JSON.stringify({
						patches: [{ key: "trust", delta: 2, reason: "warmer" }],
						stateNote: "Day update",
					}),
				),
			),
		);
		const result = await runDailyStateUpdateLocal({
			conversation: created.conversation,
			config,
			clock,
			timeline: created.timelineItems,
		});
		expect(result.applied).toHaveLength(1);
		expect(result.note).toBe("Day update");
		const duplicate = await runDailyStateUpdateLocal({
			conversation: created.conversation,
			config,
			clock: result.clock,
			timeline: created.timelineItems,
		});
		expect(duplicate.applied).toEqual([]);
		expect(resolveProvider(config).model.id).toBe("model-a");
		await expect(
			Promise.resolve().then(() =>
				resolveProvider({
					...config,
					providers: {},
				}),
			),
		).rejects.toThrow('Provider "local" is not configured.');
	});

	it("surfaces worker failures from callWorker", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ detail: "Provider down" }), {
						status: 502,
					}),
			),
		);
		await expect(
			callWorker({
				provider: resolveProvider(config),
				messages: [{ role: "user", content: "hello" }],
				promptBlocks: [],
			}),
		).rejects.toThrow("Provider down");
	});

	it("skips state updates when session state is disabled", async () => {
		const created = await createLocalConversation({
			title: "No state",
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
		const clock = await getSessionClockLocal(created.conversation.id);
		if (!clock) throw new Error("Expected session clock.");
		const result = await runDailyStateUpdateLocal({
			conversation: created.conversation,
			config,
			clock,
			timeline: created.timelineItems,
		});
		expect(result.applied).toEqual([]);
	});

	it("defaults a tactic run's messageId to null when none is supplied", async () => {
		await saveTacticLocal({
			id: "steady",
			name: "Steady",
			keywords: ["please"],
			emotionRules: [],
			blockedKeywords: [],
			instruction: "Stay steady.",
		});
		const created = await createLocalConversation({
			title: "No message id",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: true,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
			allowedTacticIds: ["steady"],
			enabledStateIds: [],
		});
		const selection = await selectLocalTactics({
			conversationId: created.conversation.id,
			message: "please",
		});
		expect(selection.runs[0]?.messageId).toBeNull();
	});

	it("returns no compaction when the summarizer produces an empty response", async () => {
		const created = await createLocalConversation({
			title: "Empty summary",
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
		const timeline = Array.from({ length: 3 }, (_, index) => ({
			id: `m${index}`,
			conversationId: created.conversation.id,
			kind: "chat" as const,
			role: "user" as const,
			content: "x".repeat(200),
			promptVisibility: "visible" as const,
			createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
		}));
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => chatResponse("")),
		);
		expect(
			await compactLocalConversation({
				conversation: created.conversation,
				config,
				timeline,
			}),
		).toBeUndefined();
	});

	it("falls back to a synthetic model entry when the provider has no matching model", () => {
		const customConfig: VioloopConfig = {
			...config,
			providers: {
				local: {
					baseUrl: "https://provider.example/v1",
					api: "openai-completions",
				},
			},
		};
		expect(resolveProvider(customConfig).model).toEqual({ id: "model-a" });
	});

	it("skips a concurrent daily state update for the same conversation and day", async () => {
		await saveStateDefinitionLocal({
			id: "trust",
			name: "Trust",
			defaultValue: 45,
		});
		const created = await createLocalConversation({
			title: "Concurrent",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: true,
				sessionState: true,
				sceneEvents: false,
			},
			allowedTacticIds: [],
			enabledStateIds: ["trust"],
		});
		const clock = await getSessionClockLocal(created.conversation.id);
		if (!clock) throw new Error("Expected session clock.");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				chatResponse(JSON.stringify({ patches: [{ key: "trust", delta: 1 }] })),
			),
		);
		const [first, second] = await Promise.all([
			runDailyStateUpdateLocal({
				conversation: created.conversation,
				config,
				clock,
				timeline: created.timelineItems,
			}),
			runDailyStateUpdateLocal({
				conversation: created.conversation,
				config,
				clock,
				timeline: created.timelineItems,
			}),
		]);
		const results = [first, second];
		expect(results.some((result) => result.applied.length === 0)).toBe(true);
		expect(results.some((result) => result.applied.length > 0)).toBe(true);
	});

	it("tolerates an unparsable worker error body and falls back to a status message", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response("not json", {
						status: 500,
						headers: { "Content-Type": "text/plain" },
					}),
			),
		);
		await expect(
			callWorker({
				provider: resolveProvider(config),
				messages: [{ role: "user", content: "hello" }],
				promptBlocks: [],
			}),
		).rejects.toThrow("Request failed with 500");
	});

	it("treats scene text without a JSON object or with malformed JSON as empty", async () => {
		const created = await createLocalConversation({
			title: "Malformed",
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
			vi.fn(async () => chatResponse("plain text response with no braces")),
		);
		expect(
			await generateOpeningScenesLocal({
				conversation: created.conversation,
				config,
			}),
		).toEqual([]);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => chatResponse('{"scenes": [broken}')),
		);
		expect(
			await generateOpeningScenesLocal({
				conversation: created.conversation,
				config,
			}),
		).toEqual([]);
	});
});
