import { randomUUID } from "node:crypto";
import type {
	ChatRequest,
	ChatResponse,
	ChatUsage,
	ConversationSummary,
	SessionProfile,
	TimelineItem,
} from "../../shared/types";
import {
	buildCompactionGuidance,
	compactConversationIfNeeded,
	toChatMessages,
} from "../compaction";
import { loadConfig, resolveActiveProvider } from "../config";
import {
	appendTimelineItem,
	getConversation,
	listTimelineItems,
	pruneTimelineItemsAfter,
	setSessionClock,
	updateTimelineItemContent,
} from "../conversations";
import { HttpError } from "../httpErrors";
import { getProviderAdapter } from "../providers";
import {
	advanceDay,
	ensureSessionClock,
	runDailyStateUpdate,
} from "../runtime";
import { buildTacticsGuidance, selectTactics } from "../tactics";
import { logUsage, storeUsage } from "./usageStore";

type StructuredChatResult = {
	messages?: Array<{
		kind?: "chat";
		content?: string;
	}>;
	timelineActions?: Array<{
		kind?: "advance_day" | "scene";
		content?: string;
	}>;
};

export async function processChat(body: ChatRequest): Promise<ChatResponse> {
	const userContent = sanitizeUserMessage(body.message);
	requireUserMessage(userContent);
	const conversation = await requireConversation(body.conversationId);
	const requestId = randomUUID();
	const conversationId = conversation.id;

	await appendTimelineItem({
		conversationId,
		kind: "chat",
		role: "user",
		speakerName: "You",
		content: userContent,
		promptVisibility: "visible",
	});

	return generateAssistantTurn({
		conversation,
		userContent,
		requestId,
	});
}

export async function editLastUserMessage(
	body: ChatRequest,
): Promise<ChatResponse> {
	const userContent = sanitizeUserMessage(body.message);
	requireUserMessage(userContent);
	const conversation = await requireConversation(body.conversationId);
	const timeline = await listTimelineItems(conversation.id);
	const lastUserMessage = findLastUserMessageWithDay(timeline);

	if (!lastUserMessage) {
		throw new HttpError(409, "No user message is available to edit.");
	}

	await updateTimelineItemContent({
		conversationId: conversation.id,
		itemId: lastUserMessage.item.id,
		content: userContent,
	});
	await pruneTimelineItemsAfter({
		conversationId: conversation.id,
		itemId: lastUserMessage.item.id,
	});
	await setSessionClock({
		conversationId: conversation.id,
		day: lastUserMessage.day,
		updatedAt: new Date().toISOString(),
	});

	return generateAssistantTurn({
		conversation,
		userContent,
		requestId: randomUUID(),
	});
}

async function requireConversation(
	conversationId: ChatRequest["conversationId"],
) {
	const userConversationId =
		typeof conversationId === "string" ? conversationId.trim() : "";

	if (!userConversationId) {
		throw new HttpError(
			400,
			"A conversationId is required. Start a new chat before sending a message.",
		);
	}

	const conversation = await getConversation(userConversationId);
	if (!conversation) {
		throw new HttpError(
			404,
			`Conversation "${userConversationId}" was not found.`,
		);
	}

	return conversation;
}

async function generateAssistantTurn(input: {
	conversation: ConversationSummary;
	userContent: string;
	requestId: string;
}): Promise<ChatResponse> {
	const config = await loadConfig();
	const provider = resolveActiveProvider(config);
	const adapter = getProviderAdapter(provider.api);
	const conversationId = input.conversation.id;
	const clock = await ensureSessionClock(conversationId);
	const compaction = await compactConversationIfNeeded({
		conversationId,
		config,
		provider,
		adapter,
	});
	const messages = toChatMessages(compaction.context.messages);
	const tacticSelection = await selectTactics({
		conversationId,
		message: input.userContent,
	});
	const tacticGuidance = buildTacticsGuidance(tacticSelection.loaded);
	let assistantRawContent = "";
	let assistantUsage: ChatUsage | undefined;

	for await (const event of adapter.streamChat({
		provider,
		messages,
		systemPrompt: [
			config.chat.systemPrompt,
			buildSessionProfileGuidance(input.conversation.profile),
			buildStructuredChatGuidance(clock.day),
			buildCompactionGuidance(compaction.context.summary),
			tacticGuidance,
		]
			.filter(Boolean)
			.join("\n\n"),
		temperature: config.chat.temperature,
		thinkingLevel: config.chat.thinkingLevel,
		cache: config.chat.cache,
	})) {
		if (event.type === "usage") {
			assistantUsage = event.usage;
			storeUsage(input.requestId, event.usage);
			logUsage(input.requestId, event.usage);
			continue;
		}

		assistantRawContent += event.text;
	}

	const structured = parseStructuredChatResult(assistantRawContent);
	const createdItems = await applyStructuredChatResult({
		conversationId,
		assistantName: input.conversation.profile.assistantName,
		currentDay: clock.day,
		result: structured,
		usage: assistantUsage,
	});

	if (createdItems.some((item) => item.kind === "day_transition")) {
		void runDailyStateUpdate({
			conversationId,
			config,
			provider,
			adapter,
		}).catch((error) => {
			const message = error instanceof Error ? error.message : "unknown error";
			console.warn(
				`[runtime] conversation=${conversationId} state update skipped: ${message}`,
			);
		});
	}

	return {
		requestId: input.requestId,
		conversationId,
		tacticIds: tacticSelection.loaded.map((tactic) => tactic.id),
		compactionId: compaction.compacted?.id,
		usage: assistantUsage,
		clock: await ensureSessionClock(conversationId),
		timelineItems: await listTimelineItems(conversationId),
		createdItems,
	};
}

function requireUserMessage(userContent: string) {
	if (!userContent) {
		throw new HttpError(400, "A user message is required.");
	}
}

function findLastUserMessageWithDay(timeline: TimelineItem[]) {
	let day = 1;
	let lastUserMessage: { item: TimelineItem; day: number } | null = null;
	for (const item of timeline) {
		if (item.kind === "day_transition") {
			const metadataDay = item.metadata?.day;
			if (typeof metadataDay === "number" && Number.isFinite(metadataDay)) {
				day = Math.max(1, Math.trunc(metadataDay));
			}
		}

		if (item.kind === "chat" && item.role === "user") {
			lastUserMessage = { item, day };
		}
	}

	return lastUserMessage;
}

function buildSessionProfileGuidance(profile: SessionProfile) {
	return [
		"Session profile:",
		`Assistant display name for this session: ${profile.assistantName}`,
		`User role in this session: ${profile.userRole}`,
		`Assistant role in this session: ${profile.assistantRole}`,
	].join("\n");
}

function buildStructuredChatGuidance(currentDay: number) {
	return [
		"Structured response contract:",
		"Return JSON only. Do not wrap it in markdown.",
		`Current day is Day ${currentDay}.`,
		'Shape: {"messages":[{"kind":"chat","content":"..."}],"timelineActions":[{"kind":"scene","content":"..."},{"kind":"advance_day","content":"Day N"}]}',
		"messages must contain normal assistant chat only.",
		"Use timelineActions for scene narration or day advancement.",
		"Advance the day when: the current scene has reached a natural narrative close, a significant change has occurred, or the interaction feels complete for this day.",
		"When advancing a day, the assistant chat message should close the current moment; the backend will place day advancement and next scene after it.",
		"Never put [scene], [day_transition], [state_update], or Day N markers in message content.",
		"At most one advance_day action is allowed, and it can only advance to the next day.",
		"At most two scene actions are allowed.",
	].join("\n");
}

async function applyStructuredChatResult(input: {
	conversationId: string;
	assistantName: string;
	currentDay: number;
	result: StructuredChatResult;
	usage?: ChatUsage;
}) {
	const createdItems = [];
	const actions = Array.isArray(input.result.timelineActions)
		? input.result.timelineActions
		: [];
	const scenes = actions
		.filter((action) => action.kind === "scene")
		.map((action) => sanitizeGeneratedContent(action.content, 800))
		.filter(Boolean)
		.slice(0, 2);
	const advance = actions.find((action) => action.kind === "advance_day");

	const messages = sanitizeAssistantMessages(input.result.messages);
	if (messages.length === 0) {
		messages.push("I could not produce a structured response.");
	}

	for (const [index, content] of messages.entries()) {
		createdItems.push(
			await appendTimelineItem({
				conversationId: input.conversationId,
				kind: "chat",
				role: "assistant",
				speakerName: input.assistantName,
				content,
				promptVisibility: "visible",
				usage: index === messages.length - 1 ? input.usage : undefined,
			}),
		);
	}

	if (advance) {
		const transition =
			sanitizeGeneratedContent(advance.content, 800) ||
			`Day ${input.currentDay + 1}`;
		createdItems.push(
			await advanceDay(input.conversationId, input.currentDay, transition),
		);
	}

	for (const scene of scenes) {
		createdItems.push(
			await appendTimelineItem({
				conversationId: input.conversationId,
				kind: "scene",
				role: "system",
				speakerName: "Scene",
				content: scene,
				promptVisibility: "context",
				metadata: { day: advance ? input.currentDay + 1 : input.currentDay },
			}),
		);
	}

	return createdItems;
}

function parseStructuredChatResult(content: string): StructuredChatResult {
	const trimmed = content.trim();
	const jsonStart = trimmed.indexOf("{");
	const jsonEnd = trimmed.lastIndexOf("}");
	if (jsonStart < 0 || jsonEnd <= jsonStart) {
		return {
			messages: [{ kind: "chat", content: stripTimelineMarkers(trimmed) }],
		};
	}

	try {
		return JSON.parse(
			trimmed.slice(jsonStart, jsonEnd + 1),
		) as StructuredChatResult;
	} catch {
		return {
			messages: [{ kind: "chat", content: stripTimelineMarkers(trimmed) }],
		};
	}
}

function sanitizeAssistantMessages(value: StructuredChatResult["messages"]) {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((message) => message.kind === undefined || message.kind === "chat")
		.map((message) =>
			sanitizeGeneratedContent(
				stripTimelineMarkers(message.content ?? ""),
				4000,
			),
		)
		.filter(Boolean)
		.slice(0, 5);
}

function sanitizeGeneratedContent(value: unknown, maxLength: number) {
	return String(value ?? "")
		.trim()
		.slice(0, maxLength);
}

function stripTimelineMarkers(value: string) {
	return value
		.replace(/^\s*\[(?:scene|day_transition|state_update)\]\s*$/gim, "")
		.trim();
}

function sanitizeUserMessage(message: ChatRequest["message"]) {
	return typeof message === "string" ? message.trim().slice(0, 20000) : "";
}
