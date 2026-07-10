import { describe, expect, it } from "vitest";
import type { LoadedTactic, TimelineItem } from "../../src/shared/types";

const clock = {
	conversationId: "c1",
	day: 2,
	updatedAt: "2026-01-01T00:00:00.000Z",
};

const profile = {
	assistantName: "Ava",
	userRole: "A tired planner.",
	assistantRole: "A calm guide.",
};

const allCapabilities = {
	tactics: true,
	dayProgression: true,
	sessionState: true,
	sceneEvents: true,
};

describe("chat prompt assembly", () => {
	it("separates global policy, session profile, runtime context, tactics, and transcript roles", async () => {
		const { assembleChatPrompt } = await import(
			"../../src/server/promptAssembly"
		);
		const tactic: LoadedTactic = {
			id: "calm",
			name: "Calm down",
			score: 4,
			keywords: ["slow"],
			emotionRules: [],
			blockedKeywords: [],
			instruction: "Use short, grounded wording.",
		};
		const prompt = assembleChatPrompt({
			globalSystemPrompt: "  Stay direct.  ",
			profile,
			capabilities: allCapabilities,
			clock,
			summary: {
				id: "summary",
				conversationId: "c1",
				summary: "Earlier durable context.",
				coveredMessageIds: ["old"],
				tokenEstimate: 100,
				createdAt: "2026-01-01T00:00:00.000Z",
				model: "model-a",
			},
			tactics: [tactic],
			timeline: [
				item("chat", "user", "Hello"),
				item("day_transition", "system", "Day 2", { day: 2 }),
				item("scene", "system", "Rain at the window."),
				{
					...item("state_update", "system", "Hidden state", { day: 2 }),
					promptVisibility: "hidden",
				},
				item("state_update", "system", "Visible state note."),
				item("chat", "assistant", "Hi"),
			],
		});

		expect(prompt.messages).toEqual([
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi" },
		]);
		const stable = block(prompt, "stable-system");
		const session = block(prompt, "session-profile");
		const dynamic = block(prompt, "dynamic-runtime");

		expect(stable).toMatchObject({ cacheScope: "stable" });
		expect(stable.content).toContain("Global behavior policy:\nStay direct.");
		expect(stable.content).toContain("Instruction priority:");
		expect(stable.content).toContain("Structured output contract:");
		expect(stable.content).toContain("runtimeActions");
		expect(stable.content).toContain(
			"messages must contain normal assistant speech only.",
		);
		expect(stable.content).not.toContain("Current day is Day 2.");
		expect(stable.content).not.toContain("Assistant display name: Ava");

		expect(session).toMatchObject({ cacheScope: "session" });
		expect(session.content).toContain("Assistant display name: Ava");
		expect(session.content).toContain("User role in this session:");
		expect(session.content).toContain("- advance_day");
		expect(session.content).toContain("- emit_scene");
		expect(session.content).toContain("- update_session_state");
		expect(session.content).not.toContain("Runtime context:");

		expect(dynamic.cacheScope).toBeUndefined();
		expect(dynamic.content).toContain("Runtime context:");
		expect(dynamic.content).toContain("Current day: Day 2.");
		expect(dynamic.content).toContain("- Day transition. Day 2. Day 2");
		expect(dynamic.content).toContain("- Scene. Rain at the window.");
		expect(dynamic.content).toContain("- Runtime state. Visible state note.");
		expect(dynamic.content).not.toContain("Hidden state");
		expect(dynamic.content).toContain("Earlier durable context.");
		expect(dynamic.content).toContain(
			"Optional response tactics for this turn:",
		);
		expect(dynamic.content).toContain("Tactic: Calm down");
	});

	it("keeps empty optional sections out while still stating current runtime day", async () => {
		const { assembleChatPrompt } = await import(
			"../../src/server/promptAssembly"
		);
		const prompt = assembleChatPrompt({
			globalSystemPrompt: "Be useful.",
			profile,
			capabilities: allCapabilities,
			clock,
			timeline: [],
			tactics: [],
		});

		expect(prompt.messages).toEqual([]);
		expect(block(prompt, "dynamic-runtime").content).toContain(
			"Current day: Day 2.",
		);
		expect(block(prompt, "dynamic-runtime").content).not.toContain(
			"Earlier conversation context",
		);
		expect(block(prompt, "dynamic-runtime").content).not.toContain("Tactic:");
	});
});

function block(
	prompt: Awaited<
		ReturnType<
			typeof import("../../src/server/promptAssembly").assembleChatPrompt
		>
	>,
	label: "stable-system" | "session-profile" | "dynamic-runtime",
) {
	return prompt.promptBlocks.find(
		(item) => item.label === label,
	) as NonNullable<(typeof prompt.promptBlocks)[number]>;
}

function item(
	kind: TimelineItem["kind"],
	role: TimelineItem["role"],
	content: string,
	metadata?: Record<string, unknown>,
): TimelineItem {
	return {
		id: `${kind}-${content}`,
		conversationId: "c1",
		kind,
		role,
		content,
		promptVisibility: "visible",
		metadata,
		createdAt: "2026-01-01T00:00:00.000Z",
	};
}
