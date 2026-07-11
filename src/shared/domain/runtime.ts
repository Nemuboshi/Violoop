import { z } from "zod";
import type { StoredCompaction, TimelineItem, UserState } from "../types";

export const chatUsageSchema = z
	.strictObject({
		promptTokens: z.number().finite().optional(),
		completionTokens: z.number().finite().optional(),
		totalTokens: z.number().finite().optional(),
		cachedPromptTokens: z.number().finite().optional(),
		cacheHitRate: z.number().finite().optional(),
	})
	.optional();

export const sessionProfileSchema = z.strictObject({
	assistantName: z.string(),
	userRole: z.string(),
	assistantRole: z.string(),
});

export const sessionCapabilitiesSchema = z.strictObject({
	tactics: z.boolean(),
	dayProgression: z.boolean(),
	sessionState: z.boolean(),
	sceneEvents: z.boolean(),
});

export const userStateSchema = z.strictObject({
	key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
	value: z.number().finite().min(0).max(100),
	source: z.enum(["explicit", "inferred", "observed"]),
	confidence: z.number().finite().min(0).max(1),
	updatedAt: z.string(),
});

export const stateDefinitionSchema = z.strictObject({
	id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
	name: z.string().trim().min(1),
	description: z.string().optional(),
	defaultValue: z.number().finite().min(0).max(100),
});

export const tacticEmotionRuleSchema = z.strictObject({
	key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
	operator: z.enum([">=", "<="]),
	value: z.number().finite().min(0).max(100),
});

export const tacticSchema = z.strictObject({
	id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
	name: z.string().trim().min(1),
	keywords: z.array(z.string()),
	emotionRules: z.array(tacticEmotionRuleSchema),
	blockedKeywords: z.array(z.string()),
	instruction: z.string(),
});

export const timelineItemSchema = z.strictObject({
	id: z.string().min(1),
	conversationId: z.string().min(1),
	kind: z.enum(["chat", "scene", "day_transition", "state_update"]),
	role: z.enum(["user", "assistant", "system"]),
	speakerName: z.string().optional(),
	content: z.string(),
	promptVisibility: z.enum(["visible", "context", "hidden"]),
	metadata: z.record(z.string(), z.unknown()).optional(),
	createdAt: z.string(),
	usage: chatUsageSchema,
});

export const conversationSchema = z.strictObject({
	id: z.string().min(1),
	title: z.string(),
	profile: sessionProfileSchema,
	capabilities: sessionCapabilitiesSchema,
	createdAt: z.string(),
	updatedAt: z.string(),
	messageCount: z.number().int().nonnegative(),
});

export const sessionClockSchema = z.strictObject({
	conversationId: z.string().min(1),
	day: z.number().int().positive(),
	stateUpdatedDay: z.number().int().positive().optional(),
	updatedAt: z.string(),
});

export const compactionSchema = z.strictObject({
	id: z.string().min(1),
	conversationId: z.string().min(1),
	summary: z.string().min(1),
	firstKeptMessageId: z.string().optional(),
	coveredMessageIds: z.array(z.string()),
	tokenEstimate: z.number().finite().nonnegative(),
	createdAt: z.string(),
	model: z.string().min(1),
});

const tacticRunReasonSchema = z.strictObject({
	reasons: z.array(z.string()),
	matchedKeywords: z.array(z.string()),
	contraindications: z.array(z.string()),
});

export const tacticRunSchema = z.strictObject({
	id: z.string().min(1),
	conversationId: z.string().nullable().optional(),
	messageId: z.string().nullable().optional(),
	tacticId: z.string().min(1),
	score: z.number().finite(),
	loaded: z.boolean(),
	decision: z.enum(["loaded", "skipped"]),
	reason: tacticRunReasonSchema,
	createdAt: z.string(),
});

const structuredRuntimeActionSchema = z.object({
	tool: z.string().optional(),
	arguments: z.record(z.string(), z.unknown()).optional(),
});

export const structuredChatResultSchema = z.object({
	messages: z
		.array(
			z.object({
				kind: z.string().optional(),
				content: z.unknown().optional(),
			}),
		)
		.optional(),
	runtimeActions: z.array(structuredRuntimeActionSchema).optional(),
});

export function parseStructuredChatResult(content: string) {
	const trimmed = content.trim();
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start < 0 || end <= start) {
		return {
			messages: [
				{ kind: "chat" as const, content: stripTimelineMarkers(trimmed) },
			],
		};
	}
	try {
		const raw = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
		if (
			raw &&
			typeof raw === "object" &&
			("messages" in raw || "runtimeActions" in raw)
		) {
			const parsed = structuredChatResultSchema.safeParse(raw);
			if (!parsed.success) return { messages: [] };
			const runtimeActions = parsed.data.runtimeActions?.filter(
				(action) =>
					action.tool === "advance_day" ||
					action.tool === "emit_scene" ||
					action.tool === "update_session_state",
			);
			return {
				...parsed.data,
				runtimeActions,
				messages: parsed.data.messages
					?.filter((message) => !message.kind || message.kind === "chat")
					.map((message) => ({
						kind: "chat" as const,
						content: message.content,
					})),
			};
		}
		return {
			messages: [
				{ kind: "chat" as const, content: stripTimelineMarkers(trimmed) },
			],
		};
	} catch {
		return {
			messages: [
				{ kind: "chat" as const, content: stripTimelineMarkers(trimmed) },
			],
		};
	}
}

export function stripTimelineMarkers(value: string) {
	return value
		.replace(/^\s*\[(?:scene|day_transition|state_update)\]\s*$/gim, "")
		.trim();
}

export function sanitizeRuntimeText(value: unknown, maxLength: number) {
	return stripTimelineMarkers(String(value ?? ""))
		.trim()
		.slice(0, maxLength);
}

export function toPromptTimeline(
	timeline: TimelineItem[],
	summary?: StoredCompaction,
) {
	if (!summary) return timeline;
	if (summary.firstKeptMessageId) {
		const index = timeline.findIndex(
			(item) => item.id === summary.firstKeptMessageId,
		);
		if (index >= 0) return timeline.slice(index);
	}
	return timeline.filter((item) => item.createdAt > summary.createdAt);
}

export function estimateMessageTokens(
	message: Pick<TimelineItem, "role" | "kind" | "content">,
) {
	return (
		Math.ceil(message.role.length / 4) +
		Math.ceil(message.kind.length / 4) +
		Math.ceil(message.content.length / 4) +
		4
	);
}

export function estimateContextTokens(
	summary: StoredCompaction | undefined,
	messages: TimelineItem[],
) {
	return (
		(summary ? Math.ceil(summary.summary.length / 4) : 0) +
		messages.reduce(
			(total, message) => total + estimateMessageTokens(message),
			0,
		)
	);
}

export function splitMessagesForCompaction(
	messages: TimelineItem[],
	keepRecentTokens: number,
) {
	let keepStart = messages.length;
	let keptTokens = 0;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const next = estimateMessageTokens(messages[index]);
		if (keptTokens > 0 && keptTokens + next > keepRecentTokens) break;
		keptTokens += next;
		keepStart = index;
	}
	return {
		compact: messages.slice(0, keepStart),
		keep: messages.slice(keepStart),
	};
}

export function formatCompactionPrompt(
	previousSummary: string | undefined,
	messages: TimelineItem[],
) {
	return [
		previousSummary
			? `Previous compacted summary:\n${previousSummary}`
			: "Previous compacted summary: none",
		"",
		"Messages to compact:",
		messages
			.map(
				(message) =>
					`${message.role.toUpperCase()} ${message.kind.toUpperCase()}:\n${message.content}`,
			)
			.join("\n\n"),
		"",
		"Return an updated compact summary that covers both the previous summary and the messages above.",
	].join("\n");
}

export function buildCompactionGuidance(summary: StoredCompaction | undefined) {
	return summary
		? [
				"Earlier conversation context has been compacted. Treat this summary as prior conversation state.",
				"Recent verbatim messages that follow are more authoritative if there is any conflict.",
				"",
				summary.summary,
			].join("\n")
		: "";
}

export function sanitizeStatePatches(states: UserState[], patches: unknown) {
	if (!Array.isArray(patches)) return [];
	const allowed = new Map(states.map((state) => [state.key, state]));
	const seen = new Set<string>();
	return patches.flatMap((raw) => {
		if (!raw || typeof raw !== "object") return [];
		const patch = raw as Record<string, unknown>;
		const key = typeof patch.key === "string" ? patch.key : "";
		if (!key || seen.has(key) || !allowed.has(key)) return [];
		seen.add(key);
		const delta = clamp(Math.trunc(Number(patch.delta)), -10, 10);
		return [{ key, delta, reason: sanitizeRuntimeText(patch.reason, 240) }];
	});
}

export function applyStatePatchValues(states: UserState[], patches: unknown) {
	const applied: Array<{
		key: string;
		previousValue: number;
		nextValue: number;
		delta: number;
		reason: string;
	}> = [];
	const sanitized = sanitizeStatePatches(states, patches);
	const stateByKey = new Map(states.map((state) => [state.key, state]));
	const now = new Date().toISOString();
	for (const patch of sanitized) {
		const state = stateByKey.get(patch.key);
		if (!state) continue;
		const previousValue = state.value;
		state.value = clamp(previousValue + patch.delta, 0, 100);
		state.source = "observed";
		state.confidence = 0.75;
		state.updatedAt = now;
		applied.push({
			key: patch.key,
			previousValue,
			nextValue: state.value,
			delta: patch.delta,
			reason: patch.reason,
		});
	}
	return applied;
}

function clamp(value: number, min: number, max: number) {
	return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 0;
}
