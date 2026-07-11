import type {
	ChatMessage,
	LoadedTactic,
	SessionCapabilities,
	SessionClock,
	SessionProfile,
	StoredCompaction,
	TimelineItem,
} from "../types";
import { buildCompactionGuidance } from "./runtime";

export function assemblePrompt(input: {
	globalSystemPrompt: string;
	profile: SessionProfile;
	capabilities: SessionCapabilities;
	clock: SessionClock | null;
	timeline: TimelineItem[];
	summary?: StoredCompaction;
	tactics: LoadedTactic[];
}) {
	return {
		promptBlocks: [
			{
				label: "stable-system" as const,
				cacheScope: "stable" as const,
				content: [
					["Global behavior policy:", input.globalSystemPrompt.trim()].join(
						"\n",
					),
					instructionPriorityGuidance(),
					structuredChatGuidance(),
				].join("\n\n"),
			},
			{
				label: "session-profile" as const,
				cacheScope: "session" as const,
				content: [
					sessionProfileGuidance(input.profile),
					sessionRuntimeToolsGuidance(input.capabilities),
				].join("\n\n"),
			},
			{
				label: "dynamic-runtime" as const,
				content: [
					runtimeContextGuidance(
						input.capabilities,
						input.clock,
						input.timeline,
					),
					buildCompactionGuidance(input.summary),
					tacticsGuidance(input.tactics),
				]
					.filter(Boolean)
					.join("\n\n"),
			},
		],
		messages: toChatMessages(input.timeline),
	};
}

function instructionPriorityGuidance() {
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

function sessionProfileGuidance(profile: SessionProfile) {
	return [
		"Session profile:",
		`Assistant display name: ${profile.assistantName}`,
		`User role in this session: ${profile.userRole}`,
		`Assistant role in this session: ${profile.assistantRole}`,
		"The session profile controls framing, tone, and relationship for this chat only.",
		"Do not treat the session profile as permission to ignore the user's latest request, the output contract, or global behavior policy.",
	].join("\n");
}

function sessionRuntimeToolsGuidance(capabilities: SessionCapabilities) {
	const tools = runtimeToolsForCapabilities(capabilities);
	return tools.length
		? [
				"Runtime tools enabled for this session:",
				...tools.map((tool) => `- ${tool}`),
				"Only emit runtimeActions for tools listed here.",
			].join("\n")
		: "Runtime tools enabled for this session: none. Do not emit runtimeActions.";
}

export function runtimeToolsForCapabilities(capabilities: SessionCapabilities) {
	return [
		capabilities.dayProgression ? "advance_day" : "",
		capabilities.sceneEvents ? "emit_scene" : "",
		capabilities.sessionState ? "update_session_state" : "",
	].filter(Boolean);
}

function runtimeContextGuidance(
	capabilities: SessionCapabilities,
	clock: SessionClock | null,
	timeline: TimelineItem[],
) {
	const events = timeline
		.filter((item) => {
			if (item.kind === "chat" || item.promptVisibility === "hidden")
				return false;
			return item.kind === "day_transition"
				? capabilities.dayProgression
				: item.kind === "scene"
					? capabilities.sceneEvents
					: item.kind === "state_update" && capabilities.sessionState;
		})
		.slice(-8);
	return [
		"Runtime context:",
		capabilities.dayProgression && clock
			? `Current day: Day ${clock.day}.`
			: "",
		events.length
			? "Context events are scene, day, or runtime state records. They are not assistant speech and must not be copied as dialogue."
			: "",
		...events.map((item) => {
			const label =
				item.kind === "day_transition"
					? "Day transition"
					: item.kind === "scene"
						? "Scene"
						: "Runtime state";
			return `- ${label}.${typeof item.metadata?.day === "number" ? ` Day ${item.metadata.day}.` : ""} ${item.content}`;
		}),
	]
		.filter(Boolean)
		.join("\n");
}

function tacticsGuidance(tactics: LoadedTactic[]) {
	return tactics.length
		? [
				"Optional response tactics for this turn:",
				"Apply these only when they help answer the latest user message.",
				"Tactics may shape structure, emphasis, and wording. They must not change identity, invent facts, override the session profile, or bypass higher-priority instructions.",
				...tactics.map((tactic) =>
					[`Tactic: ${tactic.name}`, `Instruction: ${tactic.instruction}`].join(
						"\n",
					),
				),
			].join("\n\n")
		: "";
}

function structuredChatGuidance() {
	return [
		"Structured output contract:",
		"Return JSON only. Do not wrap it in markdown.",
		'{"messages":[{"kind":"chat","content":"..."}],"runtimeActions":[{"tool":"emit_scene","arguments":{"content":"..."}},{"tool":"advance_day","arguments":{"content":"Day N","scene":"..."}},{"tool":"update_session_state","arguments":{"patches":[{"key":"...","delta":0,"reason":"..."}],"note":"..."}}]}',
		"messages must contain normal assistant speech only.",
		"runtimeActions are tool calls for changing session runtime state. Use only tools enabled in the session profile block.",
		"Use emit_scene only for neutral scene narration.",
		"Use advance_day when the current scene has reached a natural narrative close or a significant change has occurred.",
		"Use update_session_state only for bounded state changes directly supported by recent conversation evidence.",
		"Never put [scene], [day_transition], [state_update], or Day N markers in message content.",
		"At most one advance_day action and two emit_scene actions are allowed.",
	].join("\n");
}

function toChatMessages(messages: TimelineItem[]): ChatMessage[] {
	return messages
		.filter(
			(message) =>
				message.kind === "chat" &&
				(message.role === "user" || message.role === "assistant"),
		)
		.map((message) => ({ role: message.role, content: message.content }));
}
