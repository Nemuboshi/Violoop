import { afterEach, describe, expect, it, vi } from "vitest";
import {
	openAiCompletionsAdapter,
	ProviderRequestError,
} from "../../src/server/providers/openaiCompletions";
import type {
	ActiveProvider,
	StreamChatOptions,
	ThinkingFormat,
	ThinkingLevel,
} from "../../src/shared/types";

const requests: Array<{
	url: string;
	headers: Record<string, string>;
	body: Record<string, unknown>;
}> = [];

function provider(overrides: Partial<ActiveProvider> = {}): ActiveProvider {
	return {
		id: "p",
		name: "Provider",
		baseUrl: "http://provider.test/v1",
		api: "openai-completions",
		model: { id: "model" },
		apiKey: "key",
		authHeader: true,
		headers: { "x-custom": "1" },
		compat: {},
		...overrides,
	};
}

function options(
	overrides: Partial<StreamChatOptions> = {},
): StreamChatOptions {
	return {
		provider: provider(),
		promptBlocks: [
			{
				label: "stable-system",
				cacheScope: "stable",
				content: "System",
			},
		],
		messages: [{ role: "user", content: "Hello" }],
		temperature: 0.5,
		...overrides,
	};
}

function streamResponse(lines: string[]) {
	return new Response(lines.join("\n"), {
		status: 200,
		headers: { "Content-Type": "text/event-stream" },
	});
}

async function collect(streamOptions: StreamChatOptions) {
	const events = [];
	for await (const event of openAiCompletionsAdapter.streamChat(
		streamOptions,
	)) {
		events.push(event);
	}
	return events;
}

function installFetch(response: Response) {
	requests.length = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init: RequestInit) => {
			requests.push({
				url,
				headers: init.headers as Record<string, string>,
				body: JSON.parse(String(init.body)),
			});
			return response;
		}),
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("openai completions provider adapter", () => {
	it("sends provider headers, streams text, and normalizes usage", async () => {
		installFetch(
			streamResponse([
				"",
				"event: ignore",
				"data: {bad json",
				'data: {"choices":[{"delta":{"content":"Hel"}}]}',
				'data: {"choices":[{"message":{"content":"lo"}}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12,"prompt_tokens_details":{"cached_tokens":4}}}',
				"data: [DONE]",
			]),
		);

		await expect(
			collect(
				options({
					cache: { systemPrompt: true, promptCacheRetention: "24h" },
					promptBlocks: [
						{
							label: "stable-system",
							cacheScope: "stable",
							content: "Stable",
						},
						{
							label: "session-profile",
							cacheScope: "session",
							content: "Session",
						},
						{
							label: "dynamic-runtime",
							content: "Dynamic",
						},
					],
					provider: provider({
						compat: {
							supportsDeveloperRole: true,
							supportsLongCacheRetention: true,
							cacheControlFormat: "anthropic",
						},
					}),
				}),
			),
		).resolves.toEqual([
			{ type: "text", text: "Hel" },
			{ type: "text", text: "lo" },
			{
				type: "usage",
				usage: {
					promptTokens: 10,
					completionTokens: 2,
					totalTokens: 12,
					cachedPromptTokens: 4,
					cacheHitRate: 0.4,
				},
			},
		]);
		expect(requests[0]).toMatchObject({
			url: "http://provider.test/v1/chat/completions",
			headers: {
				"Content-Type": "application/json",
				"x-custom": "1",
				Authorization: "Bearer key",
			},
		});
		expect(requests[0].body).toMatchObject({
			model: "model",
			stream: true,
			temperature: 0.5,
			stream_options: { include_usage: true },
			prompt_cache_retention: "24h",
			messages: [
				{
					role: "developer",
					content: [
						{
							type: "text",
							text: "Stable",
							cache_control: { type: "ephemeral" },
						},
					],
				},
				{
					role: "developer",
					content: [
						{
							type: "text",
							text: "Session",
							cache_control: { type: "ephemeral" },
						},
					],
				},
				{ role: "developer", content: "Dynamic" },
				{ role: "user", content: "Hello" },
			],
		});
	});

	it("omits optional auth and usage fields when provider compatibility asks for strict payloads", async () => {
		installFetch(
			streamResponse([
				'data: {"choices":[{"delta":{"content":"OK"}}],"usage":{"input_tokens":5,"output_tokens":1,"input_tokens_details":{"cache_read_input_tokens":2}}}',
			]),
		);
		const events = await collect(
			options({
				provider: provider({
					apiKey: undefined,
					authHeader: false,
					headers: {},
					compat: { supportsUsageInStreaming: false },
				}),
				cache: { promptCacheRetention: "24h" },
			}),
		);
		expect(events.at(-1)).toEqual({
			type: "usage",
			usage: {
				promptTokens: 5,
				completionTokens: 1,
				totalTokens: undefined,
				cachedPromptTokens: 2,
				cacheHitRate: 0.4,
			},
		});
		expect(requests[0].headers.Authorization).toBeUndefined();
		expect(requests[0].body.stream_options).toBeUndefined();
		expect(requests[0].body.prompt_cache_retention).toBeUndefined();
		expect(requests[0].body.messages).toEqual([
			{ role: "system", content: "System" },
			{ role: "user", content: "Hello" },
		]);
	});

	it("throws provider request errors with status and upstream detail", async () => {
		installFetch(new Response("bad upstream", { status: 429 }));
		await expect(collect(options())).rejects.toMatchObject(
			new ProviderRequestError(
				429,
				"Provider request failed with 429.",
				"bad upstream",
			),
		);
	});

	it("treats a successful response without a stream body as a provider request failure", async () => {
		installFetch(new Response(null, { status: 200 }));
		await expect(collect(options())).rejects.toMatchObject(
			new ProviderRequestError(200, "Provider request failed with 200.", ""),
		);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: false,
				status: 0,
				body: null,
				text: async () => {
					throw new Error("cannot read detail");
				},
			})),
		);
		await expect(collect(options())).rejects.toMatchObject(
			new ProviderRequestError(502, "Provider request failed with 0.", ""),
		);
	});

	it("ignores usage objects without numeric token fields and supports top-level cache hit fields", async () => {
		installFetch(
			streamResponse([
				'data: {"choices":[{"delta":{"content":"OK"}}],"usage":{}}',
				'data: {"choices":[],"usage":{"prompt_tokens":0,"prompt_cache_hit_tokens":2}}',
				'data: {"choices":[],"usage":{"input_tokens":5,"cache_read_input_tokens":1}}',
			]),
		);

		await expect(collect(options())).resolves.toEqual([
			{ type: "text", text: "OK" },
			{
				type: "usage",
				usage: {
					promptTokens: 0,
					completionTokens: undefined,
					totalTokens: undefined,
					cachedPromptTokens: 2,
					cacheHitRate: undefined,
				},
			},
			{
				type: "usage",
				usage: {
					promptTokens: 5,
					completionTokens: undefined,
					totalTokens: undefined,
					cachedPromptTokens: 1,
					cacheHitRate: 0.2,
				},
			},
		]);
	});

	it.each([
		["openai", "high", { reasoning_effort: "high" }],
		["openrouter", "high", { reasoning: { effort: "high" } }],
		["qwen", "off", { enable_thinking: false }],
		[
			"qwen-chat-template",
			"low",
			{
				chat_template_kwargs: {
					enable_thinking: true,
					preserve_thinking: true,
				},
			},
		],
		[
			"deepseek",
			"medium",
			{ thinking: { type: "enabled" }, reasoning_effort: "medium" },
		],
		["deepseek", "off", { thinking: { type: "disabled" } }],
		[
			"together",
			"xhigh",
			{ reasoning: { enabled: true }, reasoning_effort: "extra" },
		],
		[
			"zai",
			"minimal",
			{
				thinking: { type: "enabled", clear_thinking: false },
				reasoning_effort: "minimal",
			},
		],
		["string-thinking", "high", { thinking: "high" }],
		[undefined, "high", { reasoning_effort: "high" }],
	] as Array<
		[ThinkingFormat | undefined, ThinkingLevel, Record<string, unknown>]
	>)("maps thinking level %s/%s into provider payload", async (thinkingFormat, thinkingLevel, expected) => {
		installFetch(
			streamResponse(['data: {"choices":[{"delta":{"content":"OK"}}]}']),
		);
		await collect(
			options({
				thinkingLevel,
				provider: provider({
					model: { id: "model", thinkingLevelMap: { xhigh: "extra" } },
					compat: { thinkingFormat, supportsReasoningEffort: true },
				}),
			}),
		);
		expect(requests[0].body).toMatchObject(expected);
	});

	it("does not send effort fields when thinking is off for openai-style providers", async () => {
		installFetch(
			streamResponse(['data: {"choices":[{"delta":{"content":"OK"}}]}']),
		);
		await collect(
			options({
				thinkingLevel: "off",
				provider: provider({
					compat: { thinkingFormat: "openai", supportsReasoningEffort: true },
				}),
			}),
		);
		expect(requests[0].body.reasoning_effort).toBeUndefined();
	});

	it("does not send provider-specific effort when the provider format does not support it", async () => {
		installFetch(
			streamResponse(['data: {"choices":[{"delta":{"content":"OK"}}]}']),
		);
		await collect(
			options({ thinkingLevel: "high", provider: provider({ compat: {} }) }),
		);
		expect(requests[0].body.reasoning_effort).toBeUndefined();

		installFetch(
			streamResponse(['data: {"choices":[{"delta":{"content":"OK"}}]}']),
		);
		await collect(
			options({
				thinkingLevel: "off",
				provider: provider({ compat: { thinkingFormat: "openrouter" } }),
			}),
		);
		expect(requests[0].body.reasoning).toBeUndefined();

		installFetch(
			streamResponse(['data: {"choices":[{"delta":{"content":"OK"}}]}']),
		);
		await collect(
			options({
				thinkingLevel: "high",
				provider: provider({
					compat: {
						thinkingFormat: "together",
						supportsReasoningEffort: false,
					},
				}),
			}),
		);
		expect(requests[0].body.reasoning).toEqual({ enabled: true });
		expect(requests[0].body.reasoning_effort).toBeUndefined();

		installFetch(
			streamResponse(['data: {"choices":[{"delta":{"content":"OK"}}]}']),
		);
		await collect(
			options({
				thinkingLevel: "off",
				provider: provider({
					compat: { thinkingFormat: "zai", supportsReasoningEffort: true },
				}),
			}),
		);
		expect(requests[0].body.thinking).toEqual({ type: "disabled" });
		expect(requests[0].body.reasoning_effort).toBeUndefined();

		installFetch(
			streamResponse(['data: {"choices":[{"delta":{"content":"OK"}}]}']),
		);
		await collect(
			options({
				thinkingLevel: "off",
				provider: provider({ compat: { thinkingFormat: "string-thinking" } }),
			}),
		);
		expect(requests[0].body.thinking).toBeUndefined();
	});
});
