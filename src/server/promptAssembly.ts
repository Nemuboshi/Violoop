import type {
	ChatMessage,
	LoadedTactic,
	PromptBlock,
	SessionClock,
	SessionProfile,
	TimelineItem,
} from "../shared/types";
import { buildCompactionGuidance, toChatMessages } from "./compaction";
import type { StoredCompaction } from "./conversations";
import { buildTacticsGuidance } from "./tactics";

type PromptAssemblyInput = {
	globalSystemPrompt: string;
	profile: SessionProfile;
	clock: SessionClock;
	timeline: TimelineItem[];
	summary?: StoredCompaction;
	tactics: LoadedTactic[];
};

export type PromptAssembly = {
	promptBlocks: PromptBlock[];
	messages: ChatMessage[];
};

export function assembleChatPrompt(input: PromptAssemblyInput): PromptAssembly {
	return {
		promptBlocks: [
			{
				label: "stable-system",
				cacheScope: "stable",
				content: [
					buildGlobalSystemGuidance(input.globalSystemPrompt),
					buildInstructionPriorityGuidance(),
					buildStructuredChatGuidance(),
				].join("\n\n"),
			},
			{
				label: "session-profile",
				cacheScope: "session",
				content: buildSessionProfileGuidance(input.profile),
			},
			{
				label: "dynamic-runtime",
				content: [
					buildRuntimeContextGuidance(input.clock, input.timeline),
					buildCompactionGuidance(input.summary),
					buildTacticsGuidance(input.tactics),
				]
					.filter(Boolean)
					.join("\n\n"),
			},
		],
		messages: toChatMessages(input.timeline),
	};
}

function buildGlobalSystemGuidance(systemPrompt: string) {
	return ["Global behavior policy:", systemPrompt.trim()].join("\n");
}

function buildInstructionPriorityGuidance() {
	return [
		"Instruction priority:",
		"1. Global behavior policy and provider/developer constraints.",
		"2. The latest explicit user request.",
		"3. The structured output contract.",
		"4. Session profile and runtime context.",
		"5. Optional response tactics for the current turn.",
		"Session profile, runtime context, and tactics shape expression; they do not override higher-priority instructions.",
	].join("\n");
}

function buildSessionProfileGuidance(profile: SessionProfile) {
	return [
		"Session profile:",
		`Assistant display name: ${profile.assistantName}`,
		`User role in this session: ${profile.userRole}`,
		`Assistant role in this session: ${profile.assistantRole}`,
		"The session profile controls framing, tone, and relationship for this chat only.",
		"Do not treat the session profile as permission to ignore the user's latest request, the output contract, or global behavior policy.",
	].join("\n");
}

function buildRuntimeContextGuidance(
	clock: SessionClock,
	timeline: TimelineItem[],
) {
	const contextEvents = timeline
		.filter(
			(item) => item.kind !== "chat" && item.promptVisibility !== "hidden",
		)
		.slice(-8);

	return [
		"Runtime context:",
		`Current day: Day ${clock.day}.`,
		"Context events are scene, day, or runtime state records. They are not assistant speech and must not be copied as dialogue.",
		...contextEvents.map(formatContextEvent),
	].join("\n");
}

function formatContextEvent(item: TimelineItem) {
	const label =
		item.kind === "day_transition"
			? "Day transition"
			: item.kind === "scene"
				? "Scene"
				: "Runtime state";
	const day =
		typeof item.metadata?.day === "number" ? ` Day ${item.metadata.day}.` : "";
	return `- ${label}.${day} ${item.content}`;
}

function buildStructuredChatGuidance() {
	return [
		"Structured output contract:",
		"Return JSON only. Do not wrap it in markdown.",
		'Shape: {"messages":[{"kind":"chat","content":"..."}],"timelineActions":[{"kind":"scene","content":"..."},{"kind":"advance_day","content":"Day N"}]}',
		"messages must contain normal assistant speech only.",
		"timelineActions are the only place for scene narration or day advancement.",
		"Advance the day when the current scene has reached a natural narrative close, a significant change has occurred, or the interaction feels complete for this day.",
		"When advancing a day, the assistant chat message should close the current moment; the backend will place day advancement and next scene after it.",
		"Never put [scene], [day_transition], [state_update], or Day N markers in message content.",
		"At most one advance_day action is allowed, and it can only advance to the next day.",
		"At most two scene actions are allowed.",
	].join("\n");
}
