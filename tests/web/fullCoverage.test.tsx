// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { Dialog } from "@base-ui/react/dialog";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VioloopConfig } from "../../src/shared/types";
import {
	createConversation,
	deleteConversation,
	fetchConversation,
	fetchConversations,
} from "../../src/web/entities/conversation";
import {
	editLastUserMessage,
	sendChatMessage,
} from "../../src/web/features/chat-session/api/chatApi";
import {
	callWorker,
	compactLocalConversation,
	generateOpeningScenesLocal,
	resolveProvider,
	runDailyStateUpdateLocal,
	selectLocalTactics,
} from "../../src/web/features/chat-session/api/localRuntime";
import { createLocalOpeningTimeline } from "../../src/web/features/chat-session/api/openingTimeline";
import {
	fetchConfig,
	saveConfig as saveConfigApi,
} from "../../src/web/features/config-settings";
import {
	clearLocal,
	deleteLocal,
	getLocal,
	listLocal,
	openVioloopDatabase,
	putLocal,
	resetMemoryDatabase,
	runLocalTransaction,
} from "../../src/web/shared/storage/database";
import {
	exportLocalData,
	serializeExport,
} from "../../src/web/shared/storage/export";
import {
	downloadLocalExport,
	importLocalExport,
} from "../../src/web/shared/storage/exportActions";
import { importLocalData } from "../../src/web/shared/storage/import";
import {
	createLocalConversation,
	ensureLocalSeed,
	removeLocalState,
	removeLocalTactic,
	saveLocalState,
	saveLocalTactic,
} from "../../src/web/shared/storage/localData";
import {
	clearAllLocalData,
	deleteConversationLocal,
	getUsageLocal,
	listConversationsLocal,
	listUsageLocal,
	markLocalSeedComplete,
	pruneConversationAfterLocal,
	replaceConversationTimelineLocal,
	saveCompactionLocal,
	saveConfig,
	saveConversationLocal,
	saveSessionClockLocal,
	saveSessionTacticIdsLocal,
	saveSessionUserStateLocal,
	saveStateDefinitionLocal,
	saveTacticLocal,
	saveTimelineItemLocal,
	saveUsageLocal,
} from "../../src/web/shared/storage/repository";
import { ConfigSettingsTab } from "../../src/web/widgets/config-modal/ui/ConfigSettingsTab";
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
			models: [{ id: "model-a" }],
		},
	},
};

function seedFetch() {
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
						}),
						usage: { promptTokens: 1 },
					}),
					{ status: 200 },
				);
			return new Response("missing", { status: 404 });
		}),
	);
}

beforeEach(async () => {
	await clearAllLocalData();
	resetMemoryDatabase();
	seedFetch();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("full coverage gaps for local-first modules", () => {
	it("uses IndexedDB facades for conversations, chat, and config", async () => {
		await saveConfig(config);
		await markLocalSeedComplete();
		await expect(fetchConfig()).resolves.toMatchObject({ provider: "local" });
		await expect(saveConfigApi(config)).resolves.toMatchObject({
			config: { chat: { defaultProvider: "local" } },
		});
		const created = await createConversation({
			title: "Facade",
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
		await expect(fetchConversations()).resolves.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: created.conversation.id }),
			]),
		);
		await expect(
			fetchConversation(created.conversation.id),
		).resolves.toMatchObject({ conversation: { id: created.conversation.id } });
		const sent = await sendChatMessage({
			conversationId: created.conversation.id,
			message: "hello",
		});
		expect(sent.createdItems.some((item) => item.content === "Answer")).toBe(
			true,
		);
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

	it("covers localData error and mutation paths", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("no", { status: 500 })),
		);
		await expect(ensureLocalSeed()).rejects.toThrow("Unable to initialize");
		seedFetch();
		await saveConfig(config);
		await markLocalSeedComplete();
		await expect(
			createLocalConversation({
				title: "ok",
				profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
				capabilities: {
					tactics: false,
					dayProgression: false,
					sessionState: false,
					sceneEvents: false,
				},
			}).then((created) =>
				Promise.all([
					(async () => {
						const { renameLocalConversation, removeLocalConversation } =
							await import("../../src/web/shared/storage/localData");
						await expect(
							renameLocalConversation("missing", "x"),
						).rejects.toThrow("was not found");
						await expect(removeLocalConversation("missing")).rejects.toThrow(
							"was not found",
						);
						return created;
					})(),
				]),
			),
		).resolves.toBeTruthy();

		await saveLocalState({ id: "mood", name: "Mood", defaultValue: 40 }, null);
		await expect(
			saveLocalState({ id: "other", name: "Other", defaultValue: 40 }, "mood"),
		).rejects.toThrow("cannot change its id");
		await expect(
			saveLocalState({ id: "mood", name: "Mood", defaultValue: 40 }, null),
		).rejects.toThrow("already exists");
		await saveLocalTactic(
			{
				id: "calm",
				name: "Calm",
				keywords: ["please"],
				emotionRules: [{ key: "mood", operator: ">=", value: 10 }],
				blockedKeywords: [],
				instruction: "Stay calm.",
			},
			null,
		);
		await expect(
			saveLocalTactic(
				{
					id: "changed",
					name: "Changed",
					keywords: [],
					emotionRules: [],
					blockedKeywords: [],
					instruction: "x",
				},
				"calm",
			),
		).rejects.toThrow("cannot change its id");
		await expect(
			saveLocalTactic(
				{
					id: "calm",
					name: "Calm",
					keywords: [],
					emotionRules: [{ key: "missing", operator: ">=", value: 1 }],
					blockedKeywords: [],
					instruction: "x",
				},
				"calm",
			),
		).rejects.toThrow("unknown states");
		await expect(removeLocalState("mood")).rejects.toThrow("used by tactics");
		await expect(removeLocalTactic("missing")).rejects.toThrow("was not found");
		await removeLocalTactic("calm");
		await expect(removeLocalState("missing")).rejects.toThrow("was not found");
		await removeLocalState("mood");
	});

	it("covers repository helpers, prune, replace, and usage", async () => {
		await saveConfig(config);
		const conversation = {
			id: "c-repo",
			title: "Repo",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: true,
				dayProgression: true,
				sessionState: true,
				sceneEvents: true,
			},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
			messageCount: 1,
		};
		const older = {
			...conversation,
			id: "c-older",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};
		await saveConversationLocal(older);
		await saveConversationLocal(conversation);
		expect((await listConversationsLocal())[0]?.id).toBe("c-repo");
		const item = {
			id: "m1",
			conversationId: "c-repo",
			kind: "chat" as const,
			role: "user" as const,
			content: "hi",
			promptVisibility: "visible" as const,
			createdAt: "2026-01-01T00:00:00.000Z",
		};
		await saveTimelineItemLocal(item);
		await saveCompactionLocal({
			id: "cmp",
			conversationId: "c-repo",
			summary: "sum",
			coveredMessageIds: [],
			tokenEstimate: 1,
			createdAt: "2026-01-01T00:00:00.000Z",
			model: "model-a",
		});
		await saveSessionClockLocal({
			conversationId: "c-repo",
			day: 2,
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		await saveSessionTacticIdsLocal("c-repo", ["calm"]);
		await saveSessionUserStateLocal("c-repo", [
			{
				key: "trust",
				value: 50,
				source: "explicit",
				confidence: 1,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		]);
		await saveUsageLocal("req-1", { promptTokens: 3 });
		expect(await getUsageLocal("req-1")).toEqual({ promptTokens: 3 });
		expect(await listUsageLocal()).toHaveLength(1);
		await pruneConversationAfterLocal(
			{ ...conversation, messageCount: 1 },
			[item],
			item.createdAt,
			{
				conversationId: "c-repo",
				day: 1,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		);
		await replaceConversationTimelineLocal(conversation, [
			{ ...item, content: "replaced" },
		]);
		await deleteConversationLocal("c-repo");
		await deleteConversationLocal("c-older");
	});

	it("covers import keep-existing merges, usage, and invalid configs", async () => {
		await saveConfig(config);
		await markLocalSeedComplete();
		const created = await createLocalConversation({
			title: "Keep",
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
		const exported = await exportLocalData();
		const withExtras = structuredClone(exported);
		withExtras.usage = [{ requestId: "u1", usage: { promptTokens: 9 } }];
		withExtras.conversations[0].timelineItems.push({
			id: "extra-item",
			conversationId: created.conversation.id,
			kind: "chat",
			role: "assistant",
			content: "extra",
			promptVisibility: "visible",
			createdAt: "2026-01-02T00:00:00.000Z",
		});
		withExtras.conversations[0].compactions.push({
			id: "extra-cmp",
			conversationId: created.conversation.id,
			summary: "extra",
			coveredMessageIds: [],
			tokenEstimate: 1,
			createdAt: "2026-01-02T00:00:00.000Z",
			model: "model-a",
		});
		withExtras.conversations[0].tacticRuns.push({
			id: "extra-run",
			conversationId: created.conversation.id,
			tacticId: "calm",
			score: 1,
			loaded: true,
			decision: "loaded",
			reason: { reasons: [], matchedKeywords: [], contraindications: [] },
			createdAt: "2026-01-02T00:00:00.000Z",
		});
		withExtras.providers.extra = {
			baseUrl: "https://extra.example/v1",
			api: "openai-completions",
		};
		await importLocalData(withExtras, { strategy: "keep-existing" });
		await expect(
			importLocalData({
				...exported,
				config: {
					chat: {
						defaultProvider: "local",
						defaultModel: "model-a",
						systemPrompt: "x",
						compaction: {
							enabled: false,
							triggerTokens: "bad" as never,
							keepRecentTokens: 1,
						},
					},
					providers: {
						local: { baseUrl: "https://x", api: "openai-completions" },
					},
				},
			}),
		).rejects.toThrow("invalid configuration");
		await expect(
			importLocalData({
				...exported,
				config: {
					chat: {
						defaultProvider: "local",
						defaultModel: "model-a",
						systemPrompt: "x",
						compaction: {
							enabled: false,
							triggerTokens: -1,
							keepRecentTokens: 1,
						},
					},
					providers: {
						local: { baseUrl: "https://x", api: "openai-completions" },
					},
				},
			}),
		).rejects.toThrow("invalid configuration");
	});

	it("covers opening timeline, compaction empties, and callWorker errors", async () => {
		await clearAllLocalData();
		await expect(
			createLocalOpeningTimeline({
				id: "x",
				title: "x",
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
			}),
		).rejects.toThrow("unavailable");
		await saveConfig(config);
		await markLocalSeedComplete();
		const created = await createLocalConversation({
			title: "Open",
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
					new Response(JSON.stringify({ text: '{"scenes":["One","Two"]}' }), {
						status: 200,
					}),
			),
		);
		expect(
			await generateOpeningScenesLocal({
				conversation: created.conversation,
				config,
			}),
		).toEqual(["One", "Two"]);
		expect(
			await compactLocalConversation({
				conversation: created.conversation,
				config: {
					...config,
					chat: {
						...config.chat,
						compaction: {
							enabled: false,
							triggerTokens: 1,
							keepRecentTokens: 1,
						},
					},
				},
				timeline: [],
			}),
		).toBeUndefined();
		expect(
			await compactLocalConversation({
				conversation: created.conversation,
				config,
				timeline: [
					{
						id: "m1",
						conversationId: created.conversation.id,
						kind: "chat",
						role: "user",
						content: "short",
						promptVisibility: "visible",
						createdAt: "2026-01-01T00:00:00.000Z",
					},
				],
			}),
		).toBeUndefined();
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
						id: "m1",
						conversationId: created.conversation.id,
						kind: "chat",
						role: "user",
						content: "x".repeat(200),
						promptVisibility: "visible",
						createdAt: "2026-01-01T00:00:00.000Z",
					},
					{
						id: "m2",
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
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
			),
		);
		await expect(
			callWorker({
				provider: resolveProvider(config),
				messages: [{ role: "user", content: "hi" }],
				promptBlocks: [],
			}),
		).rejects.toThrow("nope");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("not-json", { status: 502 })),
		);
		await expect(
			callWorker({
				provider: resolveProvider(config),
				messages: [{ role: "user", content: "hi" }],
				promptBlocks: [],
			}),
		).rejects.toThrow("502");
	});

	it("covers memory DB rollback and IndexedDB error handlers", async () => {
		vi.stubGlobal("indexedDB", undefined);
		resetMemoryDatabase();
		await putLocal("meta", { id: "a", value: 1 });
		await expect(
			runLocalTransaction([
				{ type: "put", storeName: "meta", value: { id: "b", value: 2 } },
				{
					type: "put",
					storeName: "meta",
					value: {
						get id() {
							throw new Error("boom");
						},
					},
				},
			]),
		).rejects.toThrow("boom");
		expect(await listLocal("meta")).toEqual([{ id: "a", value: 1 }]);
		await clearLocal("meta");
		vi.stubGlobal("indexedDB", (await import("fake-indexeddb")).indexedDB);
		resetMemoryDatabase();
		await openVioloopDatabase();
		await putLocal("meta", { id: "schema-check", value: true });
		expect(await getLocal("meta", "schema-check")).toMatchObject({
			value: true,
		});
		await deleteLocal("meta", "schema-check");

		const originalOpen = indexedDB.open.bind(indexedDB);
		vi.spyOn(indexedDB, "open").mockImplementation((name, version) => {
			const request = originalOpen(name, version);
			queueMicrotask(() => {
				Object.defineProperty(request, "error", {
					value: new DOMException("open failed"),
				});
				request.onerror?.(new Event("error"));
			});
			return request;
		});
		await expect(openVioloopDatabase()).rejects.toThrow();
	});

	it("covers worker URL validation and CORS branches", async () => {
		const noProvider = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});
		expect(noProvider.status).toBe(400);
		const noModel = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://provider.example/v1",
					api: "openai-completions",
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(noModel.status).toBe(400);
		const badUrl = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "not a url",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(badUrl.status).toBe(400);
		const httpRemote = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "http://provider.example/v1",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(httpRemote.status).toBe(400);
		const internal = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://svc.internal/v1",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(internal.status).toBe(400);
		const zeroHost = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://0.0.0.0/v1",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(zeroHost.status).toBe(400);
		const privateA = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://192.168.1.1/v1",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(privateA.status).toBe(400);
		const privateB = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://172.20.0.1/v1",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(privateB.status).toBe(400);
		const hugeBody = "x".repeat(2 * 1024 * 1024 + 10);
		const oversized = await workerApp.request("/api/chat", {
			method: "POST",
			body: hugeBody,
		});
		expect(oversized.status).toBe(413);
		const health = await workerApp.request(
			"/api/health",
			{
				headers: { Origin: "https://app.example" },
			},
			{
				VIOLOOP_ALLOWED_ORIGINS: "https://app.example",
			},
		);
		expect(health.status).toBe(200);
		const testBadUrl = await workerApp.request("/api/providers/test", {
			method: "POST",
			body: JSON.stringify({
				provider: { baseUrl: "::::", api: "openai-completions" },
				model: "m",
			}),
		});
		expect(testBadUrl.status).toBe(400);
		const testEmpty = await workerApp.request("/api/providers/test", {
			method: "POST",
			body: JSON.stringify({
				provider: { baseUrl: "   ", api: "openai-completions" },
				model: "m",
			}),
		});
		expect(testEmpty.status).toBe(400);
	});

	it("wires import strategy select and export replace backup branch", async () => {
		await saveConfig(config);
		await markLocalSeedComplete();
		await createLocalConversation({
			title: "Export",
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
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		const click = vi.fn();
		const anchor = document.createElement("a");
		anchor.click = click;
		const createElement = vi
			.spyOn(document, "createElement")
			.mockImplementation((tagName: string) => {
				if (tagName === "a") return anchor;
				return Document.prototype.createElement.call(document, tagName);
			});
		await downloadLocalExport();
		createElement.mockRestore();
		const exported = await exportLocalData();
		await importLocalExport(
			new File([serializeExport(exported)], "a.json", {
				type: "application/json",
			}),
			"replace",
			{ confirm: () => true },
		);
		const onImportStrategy = vi.fn();
		const user = userEvent.setup();
		render(
			<Dialog.Root open>
				<ConfigSettingsTab
					activeModelLabel="Active model"
					draft={{
						defaultModel: "model-a",
						temperature: "0.7",
						thinkingLevel: "off",
						systemPrompt: "System",
						systemPromptCache: false,
						compactionEnabled: true,
						compactionTriggerTokens: "1000",
						compactionKeepRecentTokens: "100",
					}}
					error=""
					modelOptions={[]}
					thinkingLevelOptions={[{ label: "Off", value: "off" }]}
					saving={false}
					importStrategy="replace"
					onImportStrategy={onImportStrategy}
					onImport={vi.fn()}
					onSubmit={vi.fn()}
					onUpdate={vi.fn()}
				/>
			</Dialog.Root>,
		);
		await user.click(
			screen.getByRole("combobox", { name: "Import conflict behavior" }),
		);
		await user.click(
			await screen.findByRole("option", { name: "Skip matching records" }),
		);
		expect(onImportStrategy).toHaveBeenCalledWith("skip");
	});

	it("covers daily state concurrent skip and tactic selection without persist", async () => {
		await saveStateDefinitionLocal({
			id: "trust",
			name: "Trust",
			defaultValue: 40,
		});
		await saveTacticLocal({
			id: "calm",
			name: "Calm",
			keywords: ["please"],
			emotionRules: [],
			blockedKeywords: [],
			instruction: "Stay calm.",
		});
		await saveConfig(config);
		await markLocalSeedComplete();
		const created = await createLocalConversation({
			title: "Tactics",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: true,
				dayProgression: true,
				sessionState: true,
				sceneEvents: false,
			},
			allowedTacticIds: ["calm"],
			enabledStateIds: ["trust"],
		});
		const selection = await selectLocalTactics({
			conversationId: created.conversation.id,
			message: "please",
			persist: false,
		});
		expect(selection.loaded.map((t) => t.id)).toContain("calm");
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							text: JSON.stringify({
								patches: [{ key: "trust", delta: 1 }],
								stateNote: "n",
							}),
						}),
						{ status: 200 },
					),
			),
		);
		const clock = created.clock;
		if (!clock) throw new Error("missing clock");
		const first = runDailyStateUpdateLocal({
			conversation: created.conversation,
			config,
			clock,
			timeline: created.timelineItems,
			persist: false,
		});
		const second = runDailyStateUpdateLocal({
			conversation: created.conversation,
			config,
			clock,
			timeline: created.timelineItems,
			persist: false,
		});
		const results = await Promise.all([first, second]);
		expect(results.some((result) => result.applied.length > 0)).toBe(true);
	});
});
