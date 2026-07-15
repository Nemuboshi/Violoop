import type {
	ConversationSummary,
	SessionCapabilities,
	SessionClock,
	SessionProfile,
	StateDefinition,
	Tactic,
	TacticOverview,
} from "../../src/shared/types";

export function createSessionProfile(
	overrides: Partial<SessionProfile> = {},
): SessionProfile {
	return {
		assistantName: "Violoop",
		userRole: "User",
		assistantRole: "Assistant",
		...overrides,
	};
}

export function createCapabilities(
	overrides: Partial<SessionCapabilities> = {},
): SessionCapabilities {
	return {
		tactics: false,
		dayProgression: false,
		sessionState: false,
		sceneEvents: false,
		...overrides,
	};
}

export function createConversationSummary(
	overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
	return {
		id: "c1",
		title: "Session",
		profile: createSessionProfile(),
		capabilities: createCapabilities(),
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		messageCount: 2,
		...overrides,
	};
}

export function createSessionClock(
	overrides: Partial<SessionClock> = {},
): SessionClock {
	return {
		conversationId: "c1",
		day: 1,
		updatedAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

export function createTactic(overrides: Partial<Tactic> = {}): Tactic {
	return {
		id: "calm",
		name: "Calm",
		keywords: ["please"],
		emotionRules: [],
		blockedKeywords: [],
		instruction: "Stay calm.",
		...overrides,
	};
}

export function createTacticOverview(
	overrides: Partial<TacticOverview> = {},
): TacticOverview {
	return {
		...createTactic(),
		allowedInSession: true,
		requiredStateIds: [],
		...overrides,
	};
}

export function createStateDefinition(
	overrides: Partial<StateDefinition> = {},
): StateDefinition {
	return {
		id: "urgency",
		name: "Urgency",
		defaultValue: 40,
		...overrides,
	};
}
