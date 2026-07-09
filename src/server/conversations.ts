import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type {
	ChatUsage,
	ConversationSummary,
	PromptVisibility,
	SessionClock,
	SessionProfile,
	TacticRunLogEntry,
	TimelineItem,
	TimelineItemKind,
	TimelineRole,
	UserState,
} from "../shared/types";
import { getServerPaths } from "./serverContext";

export type StoredCompaction = {
	id: string;
	conversationId: string;
	summary: string;
	firstKeptMessageId?: string;
	coveredMessageIds: string[];
	tokenEstimate: number;
	createdAt: string;
	model: string;
};

type ConversationCreatedEvent = {
	type: "conversation.created";
	eventId: string;
	conversationId: string;
	title: string;
	profile: SessionProfile;
	createdAt: string;
};

type ConversationTitleUpdatedEvent = {
	type: "conversation.title_updated";
	eventId: string;
	conversationId: string;
	title: string;
	createdAt: string;
};

type ConversationDeletedEvent = {
	type: "conversation.deleted";
	eventId: string;
	conversationId: string;
	createdAt: string;
};

type TimelineItemCreatedEvent = {
	type: "timeline.item_created";
	eventId: string;
	conversationId: string;
	itemId: string;
	kind: TimelineItemKind;
	role: TimelineRole;
	speakerName?: string;
	content: string;
	promptVisibility: PromptVisibility;
	metadata?: Record<string, unknown>;
	createdAt: string;
	usage?: ChatUsage;
};

type TimelineItemUpdatedEvent = {
	type: "timeline.item_updated";
	eventId: string;
	conversationId: string;
	itemId: string;
	content: string;
	createdAt: string;
};

type TimelineItemsPrunedAfterEvent = {
	type: "timeline.items_pruned_after";
	eventId: string;
	conversationId: string;
	itemId: string;
	createdAt: string;
};

type ConversationCompactedEvent = {
	type: "conversation.compacted";
	eventId: string;
	conversationId: string;
	compactionId: string;
	summary: string;
	firstKeptMessageId?: string;
	coveredMessageIds: string[];
	tokenEstimate: number;
	createdAt: string;
	model: string;
};

type SessionClockSetEvent = {
	type: "session.clock_set";
	eventId: string;
	conversationId: string;
	day: number;
	stateUpdatedDay?: number;
	createdAt: string;
};

type SessionTacticsSetEvent = {
	type: "session.tactics_set";
	eventId: string;
	conversationId: string;
	tacticIds: string[];
	createdAt: string;
};

type SessionUserStateSetEvent = {
	type: "session.user_state_set";
	eventId: string;
	conversationId: string;
	states: UserState[];
	createdAt: string;
};

type TacticRunLoggedEvent = TacticRunLogEntry & {
	type: "tactic.run_logged";
	eventId: string;
};

type StorageMigratedEvent = {
	type: "storage.migrated";
	eventId: string;
	createdAt: string;
	note?: string;
};

type ConversationEvent =
	| ConversationCreatedEvent
	| ConversationTitleUpdatedEvent
	| ConversationDeletedEvent
	| TimelineItemCreatedEvent
	| TimelineItemUpdatedEvent
	| TimelineItemsPrunedAfterEvent
	| ConversationCompactedEvent
	| SessionClockSetEvent
	| SessionTacticsSetEvent
	| SessionUserStateSetEvent
	| TacticRunLoggedEvent
	| StorageMigratedEvent;

const sessionProfileSchema = z.strictObject({
	assistantName: z.string(),
	userRole: z.string(),
	assistantRole: z.string(),
});

const chatUsageSchema = z
	.strictObject({
		promptTokens: z.number().optional(),
		completionTokens: z.number().optional(),
		totalTokens: z.number().optional(),
		cachedPromptTokens: z.number().optional(),
		cacheHitRate: z.number().optional(),
	})
	.optional();

const userStateSchema = z.strictObject({
	key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
	value: z.number().min(0).max(100),
	source: z.enum(["explicit", "inferred", "observed"]),
	confidence: z.number().min(0).max(1),
	updatedAt: z.string(),
});

const reasonSchema = z.strictObject({
	reasons: z.array(z.string()),
	matchedKeywords: z.array(z.string()),
	contraindications: z.array(z.string()),
});

const eventSchema = z.discriminatedUnion("type", [
	z.strictObject({
		type: z.literal("conversation.created"),
		eventId: z.string(),
		conversationId: z.string(),
		title: z.string(),
		profile: sessionProfileSchema,
		createdAt: z.string(),
	}),
	z.strictObject({
		type: z.literal("conversation.title_updated"),
		eventId: z.string(),
		conversationId: z.string(),
		title: z.string(),
		createdAt: z.string(),
	}),
	z.strictObject({
		type: z.literal("conversation.deleted"),
		eventId: z.string(),
		conversationId: z.string(),
		createdAt: z.string(),
	}),
	z.strictObject({
		type: z.literal("timeline.item_created"),
		eventId: z.string(),
		conversationId: z.string(),
		itemId: z.string(),
		kind: z.enum(["chat", "scene", "day_transition", "state_update"]),
		role: z.enum(["user", "assistant", "system"]),
		speakerName: z.string().optional(),
		content: z.string(),
		promptVisibility: z.enum(["visible", "context", "hidden"]),
		metadata: z.record(z.string(), z.unknown()).optional(),
		createdAt: z.string(),
		usage: chatUsageSchema,
	}),
	z.strictObject({
		type: z.literal("timeline.item_updated"),
		eventId: z.string(),
		conversationId: z.string(),
		itemId: z.string(),
		content: z.string(),
		createdAt: z.string(),
	}),
	z.strictObject({
		type: z.literal("timeline.items_pruned_after"),
		eventId: z.string(),
		conversationId: z.string(),
		itemId: z.string(),
		createdAt: z.string(),
	}),
	z.strictObject({
		type: z.literal("conversation.compacted"),
		eventId: z.string(),
		conversationId: z.string(),
		compactionId: z.string(),
		summary: z.string(),
		firstKeptMessageId: z.string().optional(),
		coveredMessageIds: z.array(z.string()),
		tokenEstimate: z.number(),
		createdAt: z.string(),
		model: z.string(),
	}),
	z.strictObject({
		type: z.literal("session.clock_set"),
		eventId: z.string(),
		conversationId: z.string(),
		day: z.number().int().positive(),
		stateUpdatedDay: z.number().int().positive().optional(),
		createdAt: z.string(),
	}),
	z.strictObject({
		type: z.literal("session.tactics_set"),
		eventId: z.string(),
		conversationId: z.string(),
		tacticIds: z.array(z.string()),
		createdAt: z.string(),
	}),
	z.strictObject({
		type: z.literal("session.user_state_set"),
		eventId: z.string(),
		conversationId: z.string(),
		states: z.array(userStateSchema),
		createdAt: z.string(),
	}),
	z.strictObject({
		type: z.literal("tactic.run_logged"),
		eventId: z.string(),
		id: z.string(),
		conversationId: z.string().nullable().optional(),
		messageId: z.string().nullable().optional(),
		tacticId: z.string(),
		score: z.number(),
		loaded: z.boolean(),
		decision: z.enum(["loaded", "skipped"]),
		reason: reasonSchema,
		createdAt: z.string(),
	}),
	z.strictObject({
		type: z.literal("storage.migrated"),
		eventId: z.string(),
		createdAt: z.string(),
		note: z.string().optional(),
	}),
]);

export const defaultSessionProfile: SessionProfile = {
	assistantName: "Violoop",
	userRole: "The user is asking for practical help.",
	assistantRole: "A concise assistant that answers directly.",
};

export async function createConversation(
	input: { title?: string; profile?: SessionProfile } = {},
) {
	const now = new Date().toISOString();
	const conversationId = randomUUID();
	const title = normalizeTitle(input.title);
	const profile = normalizeSessionProfile(input.profile);

	await appendEvent({
		type: "conversation.created",
		eventId: randomUUID(),
		conversationId,
		title,
		profile,
		createdAt: now,
	});

	return {
		id: conversationId,
		title,
		profile,
		createdAt: now,
		updatedAt: now,
		messageCount: 0,
	};
}

export async function getConversation(conversationId: string) {
	const projection = await replayConversations();
	return projection.conversations.get(conversationId);
}

export async function deleteConversation(conversationId: string) {
	const projection = await replayConversations();
	const conversation = projection.conversations.get(conversationId);
	if (!conversation) {
		throw new Error(`Conversation "${conversationId}" was not found.`);
	}

	await appendEvent({
		type: "conversation.deleted",
		eventId: randomUUID(),
		conversationId,
		createdAt: new Date().toISOString(),
	});
}

export async function renameConversation(
	conversationId: string,
	title?: string,
) {
	const projection = await replayConversations();
	const conversation = projection.conversations.get(conversationId);
	if (!conversation) {
		throw new Error(`Conversation "${conversationId}" was not found.`);
	}

	const nextTitle = normalizeTitle(title);
	await appendEvent({
		type: "conversation.title_updated",
		eventId: randomUUID(),
		conversationId,
		title: nextTitle,
		createdAt: new Date().toISOString(),
	});
	return { ...conversation, title: nextTitle };
}

export async function appendTimelineItem(input: {
	id?: string;
	conversationId: string;
	kind: TimelineItemKind;
	role: TimelineRole;
	speakerName?: string;
	content: string;
	promptVisibility?: PromptVisibility;
	metadata?: Record<string, unknown>;
	usage?: ChatUsage;
}) {
	const now = new Date().toISOString();
	const itemId = input.id ?? randomUUID();

	await appendEvent({
		type: "timeline.item_created",
		eventId: randomUUID(),
		conversationId: input.conversationId,
		itemId,
		kind: input.kind,
		role: input.role,
		speakerName: input.speakerName,
		content: input.content,
		promptVisibility: input.promptVisibility ?? "visible",
		metadata: input.metadata,
		usage: input.usage,
		createdAt: now,
	});

	return {
		id: itemId,
		conversationId: input.conversationId,
		kind: input.kind,
		role: input.role,
		speakerName: input.speakerName,
		content: input.content,
		promptVisibility: input.promptVisibility ?? "visible",
		metadata: input.metadata,
		usage: input.usage,
		createdAt: now,
	} satisfies TimelineItem;
}

export async function updateTimelineItemContent(input: {
	conversationId: string;
	itemId: string;
	content: string;
}) {
	const projection = await replayConversations();
	const conversation = projection.conversations.get(input.conversationId);
	if (!conversation) {
		throw new Error(`Conversation "${input.conversationId}" was not found.`);
	}

	const item = projection.timelineItems
		.get(input.conversationId)
		?.find((current) => current.id === input.itemId);
	if (!item) {
		throw new Error(`Timeline item "${input.itemId}" was not found.`);
	}

	await appendEvent({
		type: "timeline.item_updated",
		eventId: randomUUID(),
		conversationId: input.conversationId,
		itemId: input.itemId,
		content: input.content,
		createdAt: new Date().toISOString(),
	});

	return { ...item, content: input.content } satisfies TimelineItem;
}

export async function pruneTimelineItemsAfter(input: {
	conversationId: string;
	itemId: string;
}) {
	const projection = await replayConversations();
	const conversation = projection.conversations.get(input.conversationId);
	if (!conversation) {
		throw new Error(`Conversation "${input.conversationId}" was not found.`);
	}

	const itemIndex =
		projection.timelineItems
			.get(input.conversationId)
			?.findIndex((current) => current.id === input.itemId) ?? -1;
	if (itemIndex < 0) {
		throw new Error(`Timeline item "${input.itemId}" was not found.`);
	}

	await appendEvent({
		type: "timeline.items_pruned_after",
		eventId: randomUUID(),
		conversationId: input.conversationId,
		itemId: input.itemId,
		createdAt: new Date().toISOString(),
	});
}

export async function appendCompaction(input: {
	conversationId: string;
	summary: string;
	firstKeptMessageId?: string;
	coveredMessageIds: string[];
	tokenEstimate: number;
	model: string;
}) {
	const now = new Date().toISOString();
	const compactionId = randomUUID();

	await appendEvent({
		type: "conversation.compacted",
		eventId: randomUUID(),
		conversationId: input.conversationId,
		compactionId,
		summary: input.summary,
		firstKeptMessageId: input.firstKeptMessageId,
		coveredMessageIds: input.coveredMessageIds,
		tokenEstimate: input.tokenEstimate,
		model: input.model,
		createdAt: now,
	});

	return {
		id: compactionId,
		conversationId: input.conversationId,
		summary: input.summary,
		firstKeptMessageId: input.firstKeptMessageId,
		coveredMessageIds: input.coveredMessageIds,
		tokenEstimate: input.tokenEstimate,
		model: input.model,
		createdAt: now,
	};
}

export async function listConversations() {
	const projection = await replayConversations();
	return [...projection.conversations.values()].sort((a, b) =>
		b.updatedAt.localeCompare(a.updatedAt),
	);
}

export async function listTimelineItems(conversationId: string) {
	const projection = await replayConversations();
	return (projection.timelineItems.get(conversationId) ?? []).sort((a, b) =>
		a.createdAt.localeCompare(b.createdAt),
	);
}

export async function loadPromptContext(conversationId: string) {
	const projection = await replayConversations();
	const messages = (projection.timelineItems.get(conversationId) ?? [])
		.filter((item) => item.promptVisibility !== "hidden")
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	const compactions = (projection.compactions.get(conversationId) ?? []).sort(
		(a, b) => a.createdAt.localeCompare(b.createdAt),
	);
	const compaction = compactions.at(-1);

	if (!compaction) {
		return { summary: undefined, messages };
	}

	if (compaction.firstKeptMessageId) {
		const firstKeptIndex = messages.findIndex(
			(message) => message.id === compaction.firstKeptMessageId,
		);
		if (firstKeptIndex >= 0) {
			return { summary: compaction, messages: messages.slice(firstKeptIndex) };
		}
	}

	return {
		summary: compaction,
		messages: messages.filter(
			(message) => message.createdAt > compaction.createdAt,
		),
	};
}

export async function getSessionClock(conversationId: string) {
	const projection = await replayConversations();
	return projection.sessionClocks.get(conversationId);
}

export async function setSessionClock(clock: SessionClock) {
	await appendEvent({
		type: "session.clock_set",
		eventId: randomUUID(),
		conversationId: clock.conversationId,
		day: clock.day,
		stateUpdatedDay: clock.stateUpdatedDay,
		createdAt: clock.updatedAt,
	});
}

export async function getSessionTacticIds(conversationId: string) {
	const projection = await replayConversations();
	return projection.sessionTactics.get(conversationId) ?? [];
}

export async function setSessionTacticIds(
	conversationId: string,
	tacticIds: string[],
) {
	await appendEvent({
		type: "session.tactics_set",
		eventId: randomUUID(),
		conversationId,
		tacticIds,
		createdAt: new Date().toISOString(),
	});
}

export async function getSessionUserState(conversationId: string) {
	const projection = await replayConversations();
	return projection.userStates.get(conversationId);
}

export async function setSessionUserState(
	conversationId: string,
	states: UserState[],
) {
	await appendEvent({
		type: "session.user_state_set",
		eventId: randomUUID(),
		conversationId,
		states,
		createdAt: new Date().toISOString(),
	});
}

export async function appendTacticRun(
	input: Omit<TacticRunLogEntry, "id" | "createdAt">,
) {
	await appendEvent({
		type: "tactic.run_logged",
		eventId: randomUUID(),
		id: randomUUID(),
		...input,
		createdAt: new Date().toISOString(),
	});
}

export async function listRecentTacticRunsFromLog(
	conversationId?: string,
	limit = 20,
) {
	const projection = await replayConversations();
	return projection.tacticRuns
		.filter((run) => !conversationId || run.conversationId === conversationId)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.slice(0, limit);
}

async function appendEvent(event: ConversationEvent) {
	eventSchema.parse(event);
	const path = getServerPaths().conversationLogPath;
	await mkdir(dirname(path), { recursive: true });
	await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
}

async function replayConversations() {
	const conversations = new Map<string, ConversationSummary>();
	const timelineItems = new Map<string, TimelineItem[]>();
	const compactions = new Map<string, StoredCompaction[]>();
	const sessionClocks = new Map<string, SessionClock>();
	const sessionTactics = new Map<string, string[]>();
	const userStates = new Map<string, UserState[]>();
	const tacticRuns: TacticRunLogEntry[] = [];
	const deletedConversationIds = new Set<string>();

	for (const event of await readEvents()) {
		if (event.type === "storage.migrated") {
			continue;
		}

		if (event.type === "conversation.created") {
			conversations.set(event.conversationId, {
				id: event.conversationId,
				title: event.title,
				profile: event.profile,
				createdAt: event.createdAt,
				updatedAt: event.createdAt,
				messageCount: 0,
			});
			continue;
		}

		if (event.type === "conversation.deleted") {
			conversations.delete(event.conversationId);
			timelineItems.delete(event.conversationId);
			compactions.delete(event.conversationId);
			sessionClocks.delete(event.conversationId);
			sessionTactics.delete(event.conversationId);
			userStates.delete(event.conversationId);
			deletedConversationIds.add(event.conversationId);
			continue;
		}

		if (
			"conversationId" in event &&
			typeof event.conversationId === "string" &&
			deletedConversationIds.has(event.conversationId)
		) {
			continue;
		}

		if (event.type === "conversation.title_updated") {
			const conversation = conversations.get(event.conversationId);
			if (conversation) {
				conversation.title = event.title;
				conversation.updatedAt = event.createdAt;
				conversations.set(event.conversationId, conversation);
			}
			continue;
		}

		if (event.type === "conversation.compacted") {
			const bucket = compactions.get(event.conversationId) ?? [];
			bucket.push({
				id: event.compactionId,
				conversationId: event.conversationId,
				summary: event.summary,
				firstKeptMessageId: event.firstKeptMessageId,
				coveredMessageIds: event.coveredMessageIds,
				tokenEstimate: event.tokenEstimate,
				createdAt: event.createdAt,
				model: event.model,
			});
			compactions.set(event.conversationId, bucket);
			touchConversation(conversations, event.conversationId, event.createdAt);
			continue;
		}

		if (event.type === "session.clock_set") {
			sessionClocks.set(event.conversationId, {
				conversationId: event.conversationId,
				day: event.day,
				stateUpdatedDay: event.stateUpdatedDay,
				updatedAt: event.createdAt,
			});
			continue;
		}

		if (event.type === "session.tactics_set") {
			sessionTactics.set(event.conversationId, event.tacticIds);
			continue;
		}

		if (event.type === "session.user_state_set") {
			userStates.set(event.conversationId, event.states);
			continue;
		}

		if (event.type === "tactic.run_logged") {
			tacticRuns.push({
				id: event.id,
				conversationId: event.conversationId,
				messageId: event.messageId,
				tacticId: event.tacticId,
				score: event.score,
				loaded: event.loaded,
				decision: event.decision,
				reason: event.reason,
				createdAt: event.createdAt,
			});
			continue;
		}

		if (event.type === "timeline.item_updated") {
			const bucket = timelineItems.get(event.conversationId) ?? [];
			const item = bucket.find((current) => current.id === event.itemId);
			if (item) {
				item.content = event.content;
				timelineItems.set(event.conversationId, bucket);
				touchConversation(conversations, event.conversationId, event.createdAt);
			}
			continue;
		}

		if (event.type === "timeline.items_pruned_after") {
			const bucket = timelineItems.get(event.conversationId) ?? [];
			const itemIndex = bucket.findIndex(
				(current) => current.id === event.itemId,
			);
			if (itemIndex >= 0) {
				const pruned = bucket.slice(0, itemIndex + 1);
				timelineItems.set(event.conversationId, pruned);
				const conversation = conversations.get(
					event.conversationId,
				) as ConversationSummary;
				conversation.messageCount = countVisibleMessages(pruned);
				conversation.updatedAt = event.createdAt;
				conversations.set(event.conversationId, conversation);
			}
			continue;
		}

		const item: TimelineItem = {
			id: event.itemId,
			conversationId: event.conversationId,
			kind: event.kind,
			role: event.role,
			speakerName: event.speakerName,
			content: event.content,
			promptVisibility: event.promptVisibility,
			metadata: event.metadata,
			createdAt: event.createdAt,
			usage: event.usage,
		};
		const bucket = timelineItems.get(event.conversationId) ?? [];
		bucket.push(item);
		timelineItems.set(event.conversationId, bucket);

		const conversation = conversations.get(event.conversationId);
		if (!conversation) {
			throw new Error(
				`Conversation "${event.conversationId}" is missing its created event.`,
			);
		}

		conversation.updatedAt = event.createdAt;
		if (event.promptVisibility !== "hidden") {
			conversation.messageCount += 1;
		}
		conversations.set(event.conversationId, conversation);
	}

	return {
		conversations,
		timelineItems,
		compactions,
		sessionClocks,
		sessionTactics,
		userStates,
		tacticRuns,
	};
}

function countVisibleMessages(items: TimelineItem[]) {
	return items.filter((item) => item.promptVisibility !== "hidden").length;
}

async function readEvents() {
	try {
		const raw = await readFile(getServerPaths().conversationLogPath, "utf8");
		return raw
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line, index) => {
				try {
					return eventSchema.parse(JSON.parse(line)) as ConversationEvent;
				} catch (error) {
					throw new Error(
						`Invalid conversation event at line ${index + 1}: ${error instanceof Error ? error.message : "unknown error"}`,
					);
				}
			});
	} catch (error) {
		if (isNotFoundError(error)) {
			return [];
		}
		throw error;
	}
}

function touchConversation(
	conversations: Map<string, ConversationSummary>,
	conversationId: string,
	updatedAt: string,
) {
	const conversation = conversations.get(conversationId);
	if (conversation) {
		conversation.updatedAt = updatedAt;
		conversations.set(conversationId, conversation);
	}
}

function normalizeTitle(value: string | undefined) {
	const title = value?.replace(/\s+/g, " ").trim().slice(0, 80);
	return title || "New chat";
}

function normalizeSessionProfile(
	profile: SessionProfile | undefined,
): SessionProfile {
	return {
		assistantName: normalizeProfileText(
			profile?.assistantName,
			defaultSessionProfile.assistantName,
			80,
		),
		userRole: normalizeProfileText(
			profile?.userRole,
			defaultSessionProfile.userRole,
			1000,
		),
		assistantRole: normalizeProfileText(
			profile?.assistantRole,
			defaultSessionProfile.assistantRole,
			1000,
		),
	};
}

function normalizeProfileText(
	value: string | undefined,
	fallback: string,
	maxLength: number,
) {
	const normalized = value?.replace(/\s+/g, " ").trim().slice(0, maxLength);
	return normalized || fallback;
}

function isNotFoundError(error: unknown) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
