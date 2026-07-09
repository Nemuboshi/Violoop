import type {
	ChatMessage,
	ChatProviderAdapter,
	ChatUsage,
	PromptBlock,
	StreamChatOptions,
	ThinkingLevel,
} from "../../shared/types";

type OpenAiContent =
	| string
	| Array<{
			type: "text";
			text: string;
			cache_control?: { type: "ephemeral" };
	  }>;

type OpenAiMessage = Omit<ChatMessage, "content"> & {
	content: OpenAiContent;
};

export const openAiCompletionsAdapter: ChatProviderAdapter = {
	async *streamChat(options: StreamChatOptions) {
		const upstream = await fetch(
			`${options.provider.baseUrl}/chat/completions`,
			{
				method: "POST",
				headers: buildHeaders(options),
				body: JSON.stringify(buildRequestBody(options)),
			},
		);

		if (!upstream.ok || !upstream.body) {
			const detail = await upstream.text().catch(() => "");
			throw new ProviderRequestError(
				upstream.status || 502,
				`Provider request failed with ${upstream.status}.`,
				detail,
			);
		}

		const reader = upstream.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		while (true) {
			const { value, done } = await reader.read();
			if (done) {
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split(/\r?\n/);
			buffer = lines.pop() as string;

			for (const line of lines) {
				for (const event of parseStreamLine(line)) {
					yield event;
				}
			}
		}

		for (const event of parseStreamLine(buffer)) {
			yield event;
		}
	},
};

export class ProviderRequestError extends Error {
	constructor(
		readonly status: number,
		message: string,
		readonly detail: string,
	) {
		super(message);
	}
}

function buildHeaders(options: StreamChatOptions) {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...options.provider.headers,
	};

	if (options.provider.authHeader && options.provider.apiKey) {
		headers.Authorization = `Bearer ${options.provider.apiKey}`;
	}

	return headers;
}

function buildRequestBody(options: StreamChatOptions) {
	const body: Record<string, unknown> = {
		model: options.provider.model.id,
		stream: true,
		messages: buildMessages(options),
		temperature: options.temperature,
	};

	if (options.provider.compat.supportsUsageInStreaming !== false) {
		body.stream_options = { include_usage: true };
	}

	if (
		options.cache?.promptCacheRetention &&
		options.provider.compat.supportsLongCacheRetention
	) {
		body.prompt_cache_retention = options.cache.promptCacheRetention;
	}

	applyThinkingOptions(body, options);

	return body;
}

function applyThinkingOptions(
	body: Record<string, unknown>,
	options: StreamChatOptions,
) {
	const level = normalizeThinkingLevel(options.thinkingLevel);
	const enabled = level !== undefined;
	const format = options.provider.compat.thinkingFormat;
	const supportsReasoningEffort =
		options.provider.compat.supportsReasoningEffort === true;
	const effort = enabled ? mapThinkingLevel(options, level) : undefined;

	if (format === "qwen") {
		body.enable_thinking = enabled;
		return;
	}

	if (format === "qwen-chat-template") {
		body.chat_template_kwargs = {
			enable_thinking: enabled,
			preserve_thinking: true,
		};
		return;
	}

	if (format === "openrouter") {
		if (effort) {
			body.reasoning = { effort };
		}
		return;
	}

	if (format === "deepseek") {
		body.thinking = enabled ? { type: "enabled" } : { type: "disabled" };
		if (effort && supportsReasoningEffort) {
			body.reasoning_effort = effort;
		}
		return;
	}

	if (format === "together") {
		body.reasoning = { enabled };
		if (effort && supportsReasoningEffort) {
			body.reasoning_effort = effort;
		}
		return;
	}

	if (format === "zai") {
		body.thinking = enabled
			? { type: "enabled", clear_thinking: false }
			: { type: "disabled" };
		if (effort && supportsReasoningEffort) {
			body.reasoning_effort = effort;
		}
		return;
	}

	if (format === "string-thinking") {
		if (effort) {
			body.thinking = effort;
		}
		return;
	}

	if (effort && (format === "openai" || supportsReasoningEffort)) {
		body.reasoning_effort = effort;
	}
}

function normalizeThinkingLevel(
	level: ThinkingLevel | undefined,
): Exclude<ThinkingLevel, "off"> | undefined {
	if (!level || level === "off") {
		return undefined;
	}
	return level;
}

function mapThinkingLevel(
	options: StreamChatOptions,
	level: Exclude<ThinkingLevel, "off">,
) {
	const mapped = options.provider.model.thinkingLevelMap?.[level];
	return typeof mapped === "string" ? mapped : level;
}

function buildMessages(options: StreamChatOptions): OpenAiMessage[] {
	const systemRole: ChatMessage["role"] = options.provider.compat
		.supportsDeveloperRole
		? "developer"
		: "system";
	const promptMessages = options.promptBlocks
		.filter((block) => block.content.trim())
		.map((block) => ({
			role: systemRole,
			content: buildPromptBlockContent(options, block),
		}));

	return [...promptMessages, ...options.messages];
}

function buildPromptBlockContent(
	options: StreamChatOptions,
	block: PromptBlock,
): OpenAiContent {
	if (
		options.cache?.systemPrompt &&
		options.provider.compat.cacheControlFormat === "anthropic" &&
		block.cacheScope
	) {
		return [
			{
				type: "text",
				text: block.content,
				cache_control: { type: "ephemeral" },
			},
		];
	}

	return block.content;
}

function parseStreamLine(line: string) {
	const trimmed = line.trim();
	if (!trimmed.startsWith("data:")) {
		return [];
	}

	const data = trimmed.slice(5).trim();
	if (!data || data === "[DONE]") {
		return [];
	}

	try {
		const parsed = JSON.parse(data) as {
			choices?: Array<{
				delta?: { content?: string };
				message?: { content?: string };
			}>;
			usage?: unknown;
		};
		const events = [];
		const content =
			parsed.choices?.[0]?.delta?.content ??
			parsed.choices?.[0]?.message?.content ??
			"";

		if (content) {
			events.push({ type: "text" as const, text: content });
		}

		const usage = normalizeUsage(parsed.usage);
		if (usage) {
			events.push({ type: "usage" as const, usage });
		}

		return events;
	} catch {
		return [];
	}
}

function normalizeUsage(value: unknown): ChatUsage | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const promptTokens =
		readNumber(value, "prompt_tokens") ?? readNumber(value, "input_tokens");
	const completionTokens =
		readNumber(value, "completion_tokens") ??
		readNumber(value, "output_tokens");
	const totalTokens = readNumber(value, "total_tokens");
	const promptDetails = isRecord(value.prompt_tokens_details)
		? value.prompt_tokens_details
		: isRecord(value.input_tokens_details)
			? value.input_tokens_details
			: undefined;
	const cachedPromptTokens =
		(promptDetails ? readNumber(promptDetails, "cached_tokens") : undefined) ??
		(promptDetails
			? readNumber(promptDetails, "cache_read_input_tokens")
			: undefined) ??
		readNumber(value, "prompt_cache_hit_tokens") ??
		readNumber(value, "cache_read_input_tokens");

	if (
		promptTokens === undefined &&
		completionTokens === undefined &&
		totalTokens === undefined &&
		cachedPromptTokens === undefined
	) {
		return undefined;
	}

	return {
		promptTokens,
		completionTokens,
		totalTokens,
		cachedPromptTokens,
		cacheHitRate:
			promptTokens !== undefined &&
			cachedPromptTokens !== undefined &&
			promptTokens > 0
				? cachedPromptTokens / promptTokens
				: undefined,
	};
}

function readNumber(record: Record<string, unknown>, key: string) {
	const value = record[key];
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
