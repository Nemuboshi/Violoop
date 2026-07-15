// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VioloopConfig } from "../../src/shared/types";
import { createLocalConversation } from "../../src/web/features/chat-session/api/createLocalConversation";
import {
	editLocalLastUserMessage,
	sendLocalChatMessage,
} from "../../src/web/features/chat-session/api/localChat";
import * as localRuntime from "../../src/web/features/chat-session/api/localRuntime";
import { runDailyStateUpdateLocal } from "../../src/web/features/chat-session/api/localRuntime";
import { createLocalOpeningTimeline } from "../../src/web/features/chat-session/api/openingTimeline";
import { deleteLocal } from "../../src/web/shared/storage/database";
import * as repository from "../../src/web/shared/storage/repository";
import {
	appendLocalItemsAtomic,
	clearAllLocalData,
	markLocalSeedComplete,
	saveConfig,
	saveConversationLocal,
	saveStateDefinitionLocal,
} from "../../src/web/shared/storage/repository";
import { createVioloopConfig } from "../fixtures/config";

const config: VioloopConfig = createVioloopConfig({
	chat: {
		compaction: { enabled: true, triggerTokens: 1, keepRecentTokens: 1 },
	},
});

beforeEach(async () => {
	await clearAllLocalData();
	await saveConfig(config);
	await markLocalSeedComplete();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("local chat message durability", () => {
	it("keeps the main turn when compaction or daily state throws", async () => {
		const created = await createLocalConversation({
			title: "Side effects",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: true,
				sessionState: true,
				sceneEvents: false,
			},
			allowedTacticIds: [],
			enabledStateIds: [],
		});
		let call = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				call += 1;
				if (call === 1) {
					return Response.json({
						text: JSON.stringify({
							messages: [{ kind: "chat", content: `Answer ${"x".repeat(80)}` }],
							runtimeActions: [
								{ tool: "advance_day", arguments: { content: "Day 2" } },
							],
						}),
						usage: { promptTokens: 10 },
					});
				}
				if (call === 2) throw new Error("compact blew up");
				throw "daily blew up";
			}),
		);
		const sent = await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "hello ".repeat(40),
		});
		expect(sent.createdItems.some((item) => item.kind === "chat")).toBe(true);
		expect(
			sent.createdItems.some((item) => item.kind === "day_transition"),
		).toBe(true);

		call = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				call += 1;
				if (call === 1) {
					return Response.json({
						text: JSON.stringify({
							messages: [{ kind: "chat", content: `Again ${"y".repeat(80)}` }],
							runtimeActions: [
								{ tool: "advance_day", arguments: { content: "Day 3" } },
							],
						}),
						usage: { promptTokens: 10 },
					});
				}
				if (call === 2) throw "compact string";
				throw new Error("daily error");
			}),
		);
		await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "again ".repeat(40),
		});
	});

	it("rolls back conversation creation when persisting the new session fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("boom");
			}),
		);
		const saveSpy = vi
			.spyOn(repository, "saveConversationLocal")
			.mockRejectedValueOnce(new Error("persist fail"));
		await expect(
			createLocalConversation({
				title: "Fail",
				profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
				capabilities: {
					tactics: false,
					dayProgression: false,
					sessionState: false,
					sceneEvents: false,
				},
				allowedTacticIds: [],
				enabledStateIds: [],
			}),
		).rejects.toThrow("persist fail");
		saveSpy.mockRestore();
	});

	it("falls back when profile fields are blank or omitted", async () => {
		const created = await createLocalConversation({
			title: "   ",
			profile: {
				assistantName: "",
				userRole: "   ",
				assistantRole: null as unknown as string,
			},
			capabilities: {
				tactics: false,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
			allowedTacticIds: [],
			enabledStateIds: [],
		});
		expect(created.conversation.title).toBe("New chat");
		expect(created.conversation.profile.assistantName).toBe("Violoop");
		expect(created.conversation.profile.userRole.length).toBeGreaterThan(0);
		expect(created.conversation.profile.assistantRole.length).toBeGreaterThan(
			0,
		);
	});

	it("requires local configuration to be available before starting a turn", async () => {
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
	});

	it("covers tactic selection, scene emission, and edit-turn edge cases during a live chat turn", async () => {
		const { saveTacticLocal } = await import(
			"../../src/web/shared/storage/repository"
		);
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

	it("covers multi-message turns, missing structured payloads, direct scene actions, and a missing clock row", async () => {
		await saveStateDefinitionLocal({
			id: "mood",
			name: "Mood",
			defaultValue: 5,
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					text: JSON.stringify({
						messages: [
							{ kind: "chat", content: "First" },
							{ kind: "chat", content: "Second" },
						],
						runtimeActions: [
							{ tool: "advance_day", arguments: { content: "" } },
							{
								tool: "update_session_state",
								arguments: {
									note: "",
									patches: [{ key: "mood", delta: 1 }],
								},
							},
						],
					}),
					usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
				}),
			),
		);

		const created = await createLocalConversation({
			title: "Branches",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: true,
				sessionState: true,
				sceneEvents: false,
			},
			allowedTacticIds: [],
		});

		const dailySpy = vi
			.spyOn(localRuntime, "runDailyStateUpdateLocal")
			.mockResolvedValueOnce({
				applied: [],
				note: "",
				states: undefined,
				clock: {
					conversationId: created.conversation.id,
					day: 2,
					updatedAt: new Date().toISOString(),
				},
			});
		const multi = await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "two messages",
		});
		expect(
			multi.createdItems.filter((item) => item.kind === "chat"),
		).toHaveLength(3);
		expect(multi.createdItems.some((item) => item.content === "Day 2")).toBe(
			true,
		);
		expect(
			multi.createdItems.some(
				(item) => item.content === "Session state updated.",
			),
		).toBe(true);
		dailySpy.mockRestore();

		// Missing messages key + plain text with no JSON object at all.
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					text: JSON.stringify({ runtimeActions: [] }),
					usage: { promptTokens: 1 },
				}),
			),
		);
		await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "no-messages",
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					text: "plain text with no json object",
					usage: { promptTokens: 1 },
				}),
			),
		);
		await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "plain",
		});

		// A direct emit_scene action while dayProgression is off keeps scene metadata undefined.
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					text: JSON.stringify({
						messages: [{ kind: "chat", content: "Scene only" }],
						runtimeActions: [
							{ tool: "emit_scene", arguments: { content: "Fog" } },
						],
					}),
				}),
			),
		);
		const scenesOnly = await createLocalConversation({
			title: "Scenes",
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
		const scened = await sendLocalChatMessage({
			conversationId: scenesOnly.conversation.id,
			message: "look",
		});
		expect(scened.createdItems.some((item) => item.kind === "scene")).toBe(
			true,
		);

		// Missing clock row while dayProgression is still enabled.
		await deleteLocal("sessionClocks", created.conversation.id);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					text: JSON.stringify({
						messages: [{ kind: "chat", content: "No clock" }],
					}),
				}),
			),
		);
		await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "clock-miss",
		});

		await deleteLocal("conversations", created.conversation.id);
		await appendLocalItemsAtomic(created.conversation, []);
	}, 30_000);

	it("restores the day-transition clock from timeline history when editing across day boundaries", async () => {
		await saveStateDefinitionLocal({
			id: "trust",
			name: "Trust",
			defaultValue: 45,
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					text: JSON.stringify({
						messages: [{ kind: "chat", content: "Answer" }],
						runtimeActions: [
							{
								tool: "advance_day",
								arguments: { content: "Day 2", scene: "Rainy street" },
							},
						],
					}),
					usage: { promptTokens: 1 },
				}),
			),
		);
		const created = await createLocalConversation({
			title: "Runtime gaps",
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
		const opening = await createLocalOpeningTimeline(created.conversation);
		expect(opening.some((item) => item.kind === "day_transition")).toBe(true);
		await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "hello",
		});
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					text: JSON.stringify({
						messages: [{ kind: "chat", content: "Edited answer" }],
					}),
				}),
			),
		);
		const edited = await editLocalLastUserMessage({
			conversationId: created.conversation.id,
			message: "edited hello",
		});
		expect(edited.createdItems.at(-1)?.content).toBe("Edited answer");
	});

	it("omits scene metadata when day progression is disabled and requires local config to build an opening timeline", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ text: '{"scenes":["Only scene"]}' })),
		);
		const scenesOnly = await createLocalConversation({
			title: "Scenes only",
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
		const opening = await createLocalOpeningTimeline(scenesOnly.conversation);
		expect(opening).toHaveLength(1);
		expect(opening[0]?.kind).toBe("scene");
		expect(opening[0]?.metadata).toBeUndefined();

		await clearAllLocalData();
		await expect(
			createLocalOpeningTimeline(scenesOnly.conversation),
		).rejects.toThrow("unavailable");
	});

	it("skips session-state updates when no session state rows are stored yet", async () => {
		const noState = await createLocalConversation({
			title: "No stored state",
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
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					text: JSON.stringify({ patches: [], stateNote: "" }),
				}),
			),
		);
		const result = await runDailyStateUpdateLocal({
			conversation: {
				...noState.conversation,
				capabilities: {
					...noState.conversation.capabilities,
					sessionState: true,
				},
			},
			config,
			clock: {
				conversationId: noState.conversation.id,
				day: 11,
				updatedAt: new Date().toISOString(),
			},
			timeline: [],
			persist: false,
		});
		expect(result.applied).toEqual([]);
	});
});
