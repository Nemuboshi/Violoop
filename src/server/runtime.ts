import { randomUUID } from "node:crypto";
import type {
	ActiveProvider,
	ChatProviderAdapter,
	ConversationSummary,
	SessionClock,
	TimelineItem,
	VioloopConfig,
} from "../shared/types";
import {
	appendTimelineItem,
	getSessionClock,
	listTimelineItems,
	setSessionClock,
} from "./conversations";
import { ensureSessionUserState, listUserState, setUserState } from "./tactics";

type RuntimeModelResult = {
	patches?: Array<{
		key: string;
		delta: number;
		reason?: string;
	}>;
	advanceDay?: boolean;
	dayTransition?: string;
	stateNote?: string;
};

type OpeningSceneResult = {
	scenes?: string[];
};

export async function ensureSessionClock(
	conversationId: string,
): Promise<SessionClock> {
	const existing = await getSessionClock(conversationId);

	if (existing) {
		return existing;
	}

	const now = new Date().toISOString();
	const clock = { conversationId, day: 1, updatedAt: now };
	await setSessionClock(clock);
	return clock;
}

export async function createOpeningTimeline(input: {
	conversation: ConversationSummary;
	config: VioloopConfig;
	provider: ActiveProvider;
	adapter: ChatProviderAdapter;
}) {
	const conversation = input.conversation;
	await ensureSessionClock(conversation.id);

	const dayItem = await appendTimelineItem({
		conversationId: conversation.id,
		kind: "day_transition",
		role: "system",
		speakerName: "System",
		content: "Day 1",
		promptVisibility: "context",
		metadata: { day: 1 },
	});

	const sceneTexts = await generateOpeningScenes(input);
	const sceneItems = [];
	for (const scene of sceneTexts) {
		sceneItems.push(
			await appendTimelineItem({
				conversationId: conversation.id,
				kind: "scene",
				role: "system",
				speakerName: "Scene",
				content: scene,
				promptVisibility: "context",
				metadata: { day: 1 },
			}),
		);
	}

	return [dayItem, ...sceneItems];
}

async function generateOpeningScenes(input: {
	conversation: ConversationSummary;
	config: VioloopConfig;
	provider: ActiveProvider;
	adapter: ChatProviderAdapter;
}) {
	let content = "";
	for await (const event of input.adapter.streamChat({
		provider: input.provider,
		systemPrompt: [
			"Generate opening scene messages for a new Violoop chat session.",
			'Return JSON only with shape {"scenes":["..."]}.',
			"Write 1 or 2 short scene messages.",
			"The scene is neutral narration, not assistant speech.",
			"Describe the session atmosphere or starting context without making the assistant a character.",
			"Do not include assistant dialogue, user dialogue, markdown, or labels.",
			"Do not describe UI mechanics.",
		].join(" "),
		temperature: input.config.chat.temperature,
		thinkingLevel: input.config.chat.thinkingLevel,
		cache: input.config.chat.cache,
		messages: [
			{
				role: "user",
				content: JSON.stringify({
					scenePurpose:
						"Opening narration shown before the first user message.",
					assistantDisplayName: input.conversation.profile.assistantName,
					userRole: input.conversation.profile.userRole,
					assistantRole: input.conversation.profile.assistantRole,
					day: 1,
				}),
			},
		],
	})) {
		if (event.type === "text") {
			content += event.text;
		}
	}

	const parsed = parseOpeningJson(content);
	return sanitizeOpeningScenes(parsed.scenes);
}

export async function runDailyStateUpdate(input: {
	conversationId: string;
	config: VioloopConfig;
	provider: ActiveProvider;
	adapter: ChatProviderAdapter;
}) {
	const clock = await ensureSessionClock(input.conversationId);
	await ensureSessionUserState(input.conversationId);
	const states = await listUserState(input.conversationId);
	const timeline = (await listTimelineItems(input.conversationId)).slice(-12);
	const canUpdateState = clock.stateUpdatedDay !== clock.day;
	if (!canUpdateState) {
		return;
	}

	const result = await askRuntimeModel({
		...input,
		day: clock.day,
		canUpdateState,
		states,
		timeline,
	});

	const patches = sanitizePatches(
		result.patches ?? [],
		states.map((state) => state.key),
	);
	const applied = [];
	const now = new Date().toISOString();
	const stateByKey = new Map(states.map((state) => [state.key, state]));

	for (const patch of patches) {
		const current = stateByKey.get(patch.key) as (typeof states)[number];

		const previousValue = current.value;
		const nextValue = clamp(previousValue + patch.delta, 0, 100);
		current.value = nextValue;
		current.source = "observed";
		current.confidence = 0.75;
		current.updatedAt = now;

		applied.push({
			key: patch.key,
			previousValue,
			nextValue,
			delta: patch.delta,
			reason: patch.reason,
		});
	}

	await appendTimelineItem({
		conversationId: input.conversationId,
		kind: "state_update",
		role: "system",
		speakerName: "System",
		content:
			result.stateNote?.trim() ||
			`Day ${clock.day} state updated after day transition.`,
		promptVisibility: "hidden",
		metadata: { day: clock.day, patches: applied },
	});

	await setUserState(input.conversationId, states);
	await markStateUpdated(input.conversationId, clock.day);
}

async function askRuntimeModel(input: {
	conversationId: string;
	config: VioloopConfig;
	provider: ActiveProvider;
	adapter: ChatProviderAdapter;
	day: number;
	canUpdateState: boolean;
	states: Awaited<ReturnType<typeof listUserState>>;
	timeline: TimelineItem[];
}): Promise<RuntimeModelResult> {
	let content = "";
	for await (const event of input.adapter.streamChat({
		provider: input.provider,
		systemPrompt: [
			"You update Violoop session state after a day transition.",
			"Return JSON only. Do not wrap it in markdown.",
			`Allowed keys: ${input.states.map((state) => state.key).join(", ") || "none"}.`,
			"Each patch delta must be between -10 and 10.",
			"Do not decide or request day advancement.",
			"The day has already changed; adjust state for the new day using the recent timeline.",
		].join(" "),
		temperature: input.config.chat.temperature,
		thinkingLevel: input.config.chat.thinkingLevel,
		cache: input.config.chat.cache,
		messages: [
			{
				role: "user",
				content: JSON.stringify({
					day: input.day,
					canUpdateState: input.canUpdateState,
					states: input.states,
					recentTimeline: input.timeline.map((item) => ({
						kind: item.kind,
						role: item.role,
						content: item.content,
					})),
					expectedShape: {
						patches: [{ key: "urgency", delta: 0, reason: "short reason" }],
						stateNote: "",
					},
				}),
			},
		],
	})) {
		if (event.type === "text") {
			content += event.text;
		}
	}

	return parseRuntimeJson(content);
}

function sanitizePatches(
	patches: RuntimeModelResult["patches"],
	allowedStateIds: string[],
) {
	if (!Array.isArray(patches)) {
		return [];
	}

	const allowed = new Set(allowedStateIds);
	const seen = new Set<string>();
	const sanitized = [];
	for (const patch of patches) {
		if (!allowed.has(patch.key) || seen.has(patch.key)) {
			continue;
		}
		seen.add(patch.key);
		sanitized.push({
			key: patch.key,
			delta: clamp(Math.trunc(Number(patch.delta)), -10, 10),
			reason: String(patch.reason ?? "").slice(0, 240),
		});
	}

	return sanitized;
}

async function markStateUpdated(conversationId: string, day: number) {
	const current = await ensureSessionClock(conversationId);
	await setSessionClock({
		conversationId,
		day: current.day,
		stateUpdatedDay: day,
		updatedAt: new Date().toISOString(),
	});
}

export async function advanceDay(
	conversationId: string,
	currentDay: number,
	transition: string | undefined,
) {
	const nextDay = currentDay + 1;
	await setSessionClock({
		conversationId,
		day: nextDay,
		updatedAt: new Date().toISOString(),
	});

	return appendTimelineItem({
		conversationId,
		kind: "day_transition",
		role: "system",
		speakerName: "System",
		content: transition?.trim() || `Day ${nextDay}`,
		promptVisibility: "context",
		metadata: { day: nextDay, runtimeEventId: randomUUID() },
	});
}

function parseRuntimeJson(content: string): RuntimeModelResult {
	const trimmed = content.trim();
	const jsonStart = trimmed.indexOf("{");
	const jsonEnd = trimmed.lastIndexOf("}");
	if (jsonStart < 0 || jsonEnd <= jsonStart) {
		return {};
	}

	try {
		return JSON.parse(
			trimmed.slice(jsonStart, jsonEnd + 1),
		) as RuntimeModelResult;
	} catch {
		return {};
	}
}

function parseOpeningJson(content: string): OpeningSceneResult {
	const trimmed = content.trim();
	const jsonStart = trimmed.indexOf("{");
	const jsonEnd = trimmed.lastIndexOf("}");
	if (jsonStart < 0 || jsonEnd <= jsonStart) {
		return {};
	}

	try {
		return JSON.parse(
			trimmed.slice(jsonStart, jsonEnd + 1),
		) as OpeningSceneResult;
	} catch {
		return {};
	}
}

function sanitizeOpeningScenes(value: unknown) {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((item) => String(item).replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.slice(0, 2)
		.map((item) => item.slice(0, 500));
}

function clamp(value: number, min: number, max: number) {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(max, Math.max(min, value));
}
