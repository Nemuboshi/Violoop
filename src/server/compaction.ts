import {
	buildCompactionGuidance as buildSharedCompactionGuidance,
	estimateContextTokens,
	formatCompactionPrompt,
	splitMessagesForCompaction,
} from "../shared/domain/runtime";
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

const compactionJobs = new Set<string>();

export function scheduleConversationCompaction(
	input: CompactConversationInput,
): void {
	if (compactionJobs.has(input.conversationId)) {
		return;
	}

	compactionJobs.add(input.conversationId);
	void compactConversationIfNeeded(input)
		.catch((error) => {
			const message = error instanceof Error ? error.message : "unknown error";
			console.warn(
				`[compaction] conversation=${input.conversationId} skipped: ${message}`,
			);
		})
		.finally(() => {
			compactionJobs.delete(input.conversationId);
		});
}

export async function compactConversationIfNeeded(
	input: CompactConversationInput,
): Promise<CompactConversationResult> {
	const context = await loadPromptContext(input.conversationId);
	const options = input.config.chat.compaction;

	if (!options.enabled) {
		return { context };
	}

	const currentEstimate = estimateContextTokens(
		context.summary,
		context.messages,
	);
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
	return buildSharedCompactionGuidance(summary);
}

export function toChatMessages(messages: TimelineItem[]): ChatMessage[] {
	return messages
		.filter(
			(message) =>
				message.kind === "chat" &&
				(message.role === "user" || message.role === "assistant"),
		)
		.map((message) => ({
			role: message.role,
			content: message.content,
		}));
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
		promptBlocks: [
			{
				label: "stable-system",
				cacheScope: "stable",
				content: summarySystemPrompt,
			},
		],
		temperature: input.temperature,
		thinkingLevel: input.thinkingLevel,
		cache: input.cache,
		messages: [
			{
				role: "user",
				content: formatCompactionPrompt(input.previousSummary, input.messages),
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
