import type {
	ActiveProvider,
	ChatMessage,
	ChatProviderAdapter,
	TimelineItem,
	VioloopConfig,
} from "../shared/types";
import {
	appendCompaction,
	loadPromptContext,
	type StoredCompaction,
} from "./conversations";

type PromptContext = {
	summary?: StoredCompaction;
	messages: TimelineItem[];
};

type CompactConversationInput = {
	conversationId: string;
	config: VioloopConfig;
	provider: ActiveProvider;
	adapter: ChatProviderAdapter;
};

type CompactConversationResult = {
	context: PromptContext;
	compacted?: StoredCompaction;
};

const summarySystemPrompt = [
	"You compact chat history for a chatbot session.",
	"Preserve durable facts, user goals, decisions, constraints, unresolved tasks, and important assistant actions.",
	"Do not add new facts. Do not mention that this is a summary unless needed by the content.",
	"Prefer dense bullet points grouped by topic. Keep wording concise.",
].join(" ");

export async function compactConversationIfNeeded(
	input: CompactConversationInput,
): Promise<CompactConversationResult> {
	const context = await loadPromptContext(input.conversationId);
	const options = input.config.chat.compaction;

	if (!options.enabled) {
		return { context };
	}

	const currentEstimate = estimateContextTokens(context);
	if (currentEstimate < options.triggerTokens) {
		return { context };
	}

	const split = splitMessagesForCompaction(
		context.messages,
		options.keepRecentTokens,
	);
	if (split.compact.length === 0) {
		return { context };
	}

	try {
		const summary = await summarizeCompaction({
			adapter: input.adapter,
			provider: input.provider,
			previousSummary: context.summary?.summary,
			messages: split.compact,
			temperature: input.config.chat.temperature,
			thinkingLevel: input.config.chat.thinkingLevel,
			cache: input.config.chat.cache,
		});

		const compacted = await appendCompaction({
			conversationId: input.conversationId,
			summary,
			firstKeptMessageId: split.keep[0]?.id,
			coveredMessageIds: split.compact.map((message) => message.id),
			tokenEstimate: currentEstimate,
			model: input.provider.model.id,
		});

		console.log(
			`[compaction] conversation=${input.conversationId} estimate=${currentEstimate} compacted=${split.compact.length} kept=${split.keep.length}`,
		);

		return {
			context: await loadPromptContext(input.conversationId),
			compacted,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown error";
		console.warn(
			`[compaction] conversation=${input.conversationId} skipped: ${message}`,
		);
		return { context };
	}
}

export function buildCompactionGuidance(summary: StoredCompaction | undefined) {
	if (!summary) {
		return "";
	}

	return [
		"Earlier conversation context has been compacted. Treat this summary as prior conversation state.",
		"Recent verbatim messages that follow are more authoritative if there is any conflict.",
		"",
		summary.summary,
	].join("\n");
}

export function toChatMessages(messages: TimelineItem[]): ChatMessage[] {
	return messages.map((message) => ({
		role: message.role === "user" ? "user" : "assistant",
		content: formatTimelineItemForPrompt(message),
	}));
}

function splitMessagesForCompaction(
	messages: TimelineItem[],
	keepRecentTokens: number,
) {
	let keepStart = messages.length;
	let keptTokens = 0;

	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const nextTokens = estimateMessageTokens(messages[index]);
		if (keptTokens > 0 && keptTokens + nextTokens > keepRecentTokens) {
			break;
		}
		keptTokens += nextTokens;
		keepStart = index;
	}

	return {
		compact: messages.slice(0, keepStart),
		keep: messages.slice(keepStart),
	};
}

async function summarizeCompaction(input: {
	adapter: ChatProviderAdapter;
	provider: ActiveProvider;
	previousSummary?: string;
	messages: TimelineItem[];
	temperature?: number;
	thinkingLevel?: VioloopConfig["chat"]["thinkingLevel"];
	cache?: VioloopConfig["chat"]["cache"];
}) {
	let summary = "";

	for await (const event of input.adapter.streamChat({
		provider: input.provider,
		systemPrompt: summarySystemPrompt,
		temperature: input.temperature,
		thinkingLevel: input.thinkingLevel,
		cache: input.cache,
		messages: [
			{
				role: "user",
				content: buildSummaryPrompt(input.previousSummary, input.messages),
			},
		],
	})) {
		if (event.type === "text") {
			summary += event.text;
		}
	}

	const trimmed = summary.trim();
	if (!trimmed) {
		throw new Error("Compaction summary was empty.");
	}

	return trimmed;
}

function buildSummaryPrompt(
	previousSummary: string | undefined,
	messages: TimelineItem[],
) {
	return [
		previousSummary
			? `Previous compacted summary:\n${previousSummary}`
			: "Previous compacted summary: none",
		"",
		"Messages to compact:",
		formatTranscript(messages),
		"",
		"Return an updated compact summary that covers both the previous summary and the messages above.",
	].join("\n");
}

function formatTranscript(messages: TimelineItem[]) {
	return messages
		.map(
			(message) =>
				`${message.role.toUpperCase()} ${message.kind.toUpperCase()}:\n${message.content}`,
		)
		.join("\n\n");
}

function estimateContextTokens(context: PromptContext) {
	return (
		estimateTextTokens(context.summary?.summary ?? "") +
		context.messages.reduce(
			(sum, message) => sum + estimateMessageTokens(message),
			0,
		)
	);
}

function estimateMessageTokens(message: TimelineItem) {
	return (
		estimateTextTokens(message.role) +
		estimateTextTokens(message.kind) +
		estimateTextTokens(message.content) +
		4
	);
}

function estimateTextTokens(value: string) {
	return Math.ceil(value.length / 4);
}

function formatTimelineItemForPrompt(message: TimelineItem) {
	if (message.kind === "chat") {
		return message.content;
	}

	if (message.kind === "day_transition") {
		return `Context event: day transition.\n${message.content}`;
	}

	if (message.kind === "scene") {
		return `Context event: scene narration.\n${message.content}`;
	}

	return `Context event: ${message.kind}.\n${message.content}`;
}
