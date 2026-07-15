import { vi } from "vitest";
import type { VioloopConfig } from "../../../src/shared/types";
import {
	createAppConfigSnapshot,
	createWebVioloopConfig,
} from "../../fixtures/config";
import {
	createConversationSummary,
	createSessionClock,
	createSessionProfile,
	createStateDefinition,
	createTacticOverview,
} from "../../fixtures/session";

export function jsonResponse(payload: unknown, init: ResponseInit = {}) {
	return new Response(JSON.stringify(payload), {
		status: init.status ?? 200,
		headers: { "Content-Type": "application/json" },
	});
}

export function mockFetch(...responses: Array<Response | (() => Response)>) {
	const fetchMock = vi.fn(async () => {
		const next = responses.shift();
		if (!next) {
			throw new Error("Unexpected fetch call");
		}
		return typeof next === "function" ? next() : next;
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

export function queueMock(
	fn: ReturnType<typeof vi.fn>,
	...responses: Array<unknown | (() => unknown)>
) {
	const queue = [...responses];
	fn.mockImplementation(async () => {
		const next = queue.shift();
		if (next === undefined) {
			throw new Error("Unexpected API call");
		}
		if (typeof next === "function") {
			return (next as () => unknown)();
		}
		return next;
	});
	return fn;
}

export const profile = createSessionProfile();

export const conversation = createConversationSummary();

export const clock = createSessionClock();

export const assistantMessage = {
	id: "a1",
	conversationId: "c1",
	kind: "chat",
	role: "assistant",
	speakerName: "Violoop",
	content: "Hello",
	promptVisibility: "visible",
	createdAt: "2026-01-01T00:00:00.000Z",
	usage: { promptTokens: 10, cachedPromptTokens: 5, completionTokens: 4 },
};

export const config: VioloopConfig = createWebVioloopConfig({
	chat: { cache: { systemPrompt: true } },
	providers: {
		local: {
			name: "Local",
			baseUrl: "http://provider.test",
			api: "openai-completions",
			models: [{ id: "model-a" }],
		},
		backup: {
			name: "Backup",
			baseUrl: "http://backup.test",
			api: "openai-completions",
			models: [{ id: "model-b" }],
		},
	},
});

export const configResponse = createAppConfigSnapshot({ config });

export const tactic = createTacticOverview();

export const stateDefinition = createStateDefinition();
