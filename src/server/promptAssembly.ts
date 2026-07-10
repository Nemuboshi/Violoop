import type {
	ChatMessage,
	LoadedTactic,
	PromptBlock,
	SessionCapabilities,
	SessionClock,
	SessionProfile,
	TimelineItem,
} from "../shared/types";
import { buildCompactionGuidance, toChatMessages } from "./compaction";
import type { StoredCompaction } from "./conversations";
import { runtimeToolsForCapabilities } from "./runtime";
import { buildTacticsGuidance } from "./tactics";

type PromptAssemblyInput = {
	globalSystemPrompt: string;
	profile: SessionProfile;
	capabilities: SessionCapabilities;
	clock: SessionClock | null;
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
				content: [
					buildSessionProfileGuidance(input.profile),
					buildSessionRuntimeToolsGuidance(input.capabilities),
				]
					.filter(Boolean)
					.join("\n\n"),
			},
			{
				label: "dynamic-runtime",
				content: [
					buildRuntimeContextGuidance(
						input.capabilities,
						input.clock,
						input.timeline,
					),
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

function buildSessionRuntimeToolsGuidance(capabilities: SessionCapabilities) {
	const tools = runtimeToolsForCapabilities(capabilities);
	if (tools.length === 0) {
		return "Runtime tools enabled for this session: none. Do not emit runtimeActions.";
	}

	return [
		"Runtime tools enabled for this session:",
		...tools.map((tool) => `- ${tool}`),
		"Only emit runtimeActions for tools listed here.",
	].join("\n");
}

function buildRuntimeContextGuidance(
	capabilities: SessionCapabilities,
	clock: SessionClock | null,
	timeline: TimelineItem[],
) {
	const contextEvents = timeline
		.filter(
			(item) =>
				item.kind !== "chat" &&
				item.promptVisibility !== "hidden" &&
				isRuntimeEventVisibleToPrompt(item, capabilities),
		)
		.slice(-8);

	return [
		"Runtime context:",
		capabilities.dayProgression && clock
			? `Current day: Day ${clock.day}.`
			: "",
		contextEvents.length > 0
			? "Context events are scene, day, or runtime state records. They are not assistant speech and must not be copied as dialogue."
			: "",
		...contextEvents.map(formatContextEvent),
	]
		.filter(Boolean)
		.join("\n");
}

function isRuntimeEventVisibleToPrompt(
	item: TimelineItem,
	capabilities: SessionCapabilities,
) {
	if (item.kind === "day_transition") {
		return capabilities.dayProgression;
	}
	if (item.kind === "scene") {
		return capabilities.sceneEvents;
	}
	if (item.kind === "state_update") {
		return capabilities.sessionState;
	}
	return false;
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
		'Shape: {"messages":[{"kind":"chat","content":"..."}],"runtimeActions":[{"tool":"emit_scene","arguments":{"content":"..."}},{"tool":"advance_day","arguments":{"content":"Day N","scene":"..."}},{"tool":"update_session_state","arguments":{"patches":[{"key":"...","delta":0,"reason":"..."}],"note":"..."}}]}',
		"messages must contain normal assistant speech only.",
		"runtimeActions are tool calls for changing session runtime state. Use only tools enabled in the session profile block.",
		"Use emit_scene only for neutral scene narration.",
		"Use advance_day when the current scene has reached a natural narrative close, a significant change has occurred, or the interaction feels complete for this day.",
		"When advancing a day, the assistant chat message should close the current moment; the backend will place day advancement and optional next scene after it.",
		"Use update_session_state only for bounded state changes directly supported by recent conversation evidence.",
		"Never put [scene], [day_transition], [state_update], or Day N markers in message content.",
		"At most one advance_day action is allowed, and it can only advance to the next day.",
		"At most two emit_scene actions are allowed.",
	].join("\n");
}
