// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { Dialog } from "@base-ui/react/dialog";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VioloopConfig } from "../../src/shared/types";
import {
	editLocalLastUserMessage,
	sendLocalChatMessage,
} from "../../src/web/features/chat-session/api/localChat";
import {
	generateOpeningScenesLocal,
	runDailyStateUpdateLocal,
} from "../../src/web/features/chat-session/api/localRuntime";
import { createLocalOpeningTimeline } from "../../src/web/features/chat-session/api/openingTimeline";
import { exportLocalData } from "../../src/web/shared/storage/export";
import { importLocalData } from "../../src/web/shared/storage/import";
import {
	createLocalConversation,
	saveLocalConfig,
} from "../../src/web/shared/storage/localData";
import {
	clearAllLocalData,
	saveStateDefinitionLocal,
} from "../../src/web/shared/storage/repository";
import { ChatTimeline } from "../../src/web/widgets/chat-panel";
import { ConfigSettingsTab } from "../../src/web/widgets/config-modal/ui/ConfigSettingsTab";

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

function runtimeResponse(body: Record<string, unknown>) {
	return new Response(
		JSON.stringify({
			text: JSON.stringify(body),
			usage: { promptTokens: 1 },
		}),
		{ status: 200 },
	);
}

beforeEach(async () => {
	await clearAllLocalData();
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
				return runtimeResponse({
					messages: [{ kind: "chat", content: "Answer" }],
					runtimeActions: [
						{
							tool: "advance_day",
							arguments: { content: "Day 2", scene: "Rainy street" },
						},
						{ tool: "emit_scene", arguments: { content: "Thunder" } },
					],
				});
			return new Response("missing", { status: 404 });
		}),
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("remaining local-first coverage gaps", () => {
	it("exports empty config and validates import cross references", async () => {
		const exported = await exportLocalData();
		expect(exported.config.chat.defaultProvider).toBe("");
		await saveLocalConfig(config);
		const created = await createLocalConversation({
			title: "Import checks",
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
		const payload = await exportLocalData();
		const conversationId = created.conversation.id;
		const brokenTimeline = structuredClone(payload);
		brokenTimeline.conversations[0].timelineItems.push({
			id: "extra",
			conversationId: "wrong",
			kind: "chat",
			role: "user",
			content: "x",
			promptVisibility: "visible",
			createdAt: new Date().toISOString(),
		});
		await expect(importLocalData(brokenTimeline)).rejects.toThrow(
			"invalid timeline item",
		);
		const brokenCompaction = structuredClone(payload);
		brokenCompaction.conversations[0].compactions = [
			{
				id: "cmp",
				conversationId: "wrong",
				summary: "x",
				coveredMessageIds: [],
				tokenEstimate: 1,
				createdAt: new Date().toISOString(),
				model: "model-a",
			},
		];
		await expect(importLocalData(brokenCompaction)).rejects.toThrow(
			"invalid compaction",
		);
		const brokenRun = structuredClone(payload);
		brokenRun.conversations[0].tacticRuns = [
			{
				id: "run",
				conversationId: "wrong",
				tacticId: "calm",
				score: 1,
				loaded: true,
				decision: "loaded",
				reason: { reasons: [], matchedKeywords: [], contraindications: [] },
				createdAt: new Date().toISOString(),
			},
		];
		await expect(importLocalData(brokenRun)).rejects.toThrow(
			"invalid tactic run",
		);
		expect(conversationId).toBeTruthy();
	});

	it("covers opening scenes, daily state dedupe, and edit clock restore", async () => {
		await saveStateDefinitionLocal({
			id: "trust",
			name: "Trust",
			defaultValue: 45,
		});
		const created = await createLocalConversation({
			title: "Runtime gaps",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: true,
				dayProgression: true,
				sessionState: true,
				sceneEvents: true,
			},
			allowedTacticIds: [],
			enabledStateIds: ["trust"],
		});
		const opening = await createLocalOpeningTimeline(created.conversation);
		expect(opening.some((item) => item.kind === "day_transition")).toBe(true);
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ text: "not-json" }), { status: 200 }),
			),
		);
		expect(
			await generateOpeningScenesLocal({
				conversation: created.conversation,
				config,
			}),
		).toEqual([]);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				runtimeResponse({
					patches: [{ key: "trust", delta: 1 }],
					stateNote: "Updated",
				}),
			),
		);
		const clock = created.clock;
		if (!clock) throw new Error("Expected session clock.");
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
		expect(first.applied.length + second.applied.length).toBeGreaterThan(0);
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL) => {
				if (String(input).endsWith("/api/chat"))
					return runtimeResponse({
						messages: [{ kind: "chat", content: "Edited answer" }],
					});
				return new Response("missing", { status: 404 });
			}),
		);
		await sendLocalChatMessage({
			conversationId: created.conversation.id,
			message: "hello",
		});
		const edited = await editLocalLastUserMessage({
			conversationId: created.conversation.id,
			message: "edited hello",
		});
		expect(edited.createdItems.at(-1)?.content).toBe("Edited answer");
	});

	it("wires settings import controls and timeline keyboard reveal", async () => {
		const onImportStrategy = vi.fn();
		const onImport = vi.fn();
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
					onImport={onImport}
					onSubmit={vi.fn()}
					onUpdate={vi.fn()}
				/>
			</Dialog.Root>,
		);
		onImportStrategy("skip");
		const file = new File(["{}"], "violoop.json", { type: "application/json" });
		const input = document.querySelector(
			"input[type='file']",
		) as HTMLInputElement;
		await userEvent.setup().upload(input, file);
		expect(onImport).toHaveBeenCalledWith(file, "replace");
		fireEvent.change(input, { target: { files: null } });
		expect(onImport).toHaveBeenCalledTimes(1);

		const onEditStart = vi.fn();
		const { unmount } = render(
			<ChatTimeline
				status="idle"
				scrollRef={{ current: null }}
				onEditStart={onEditStart}
				items={[
					{
						id: "user-last",
						itemClassName: "user-item",
						speakerClassName: "user-speaker",
						speaker: "You",
						contentClassName: "user-content",
						content: "Hello",
						editable: true,
					},
				]}
			/>,
		);
		const row = screen.getByText("Hello").closest("article");
		fireEvent.keyDown(row as HTMLElement, { key: "Enter" });
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		expect(onEditStart).toHaveBeenCalled();
		unmount();
	});
});
