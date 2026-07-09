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
		expect(prompt.systemPrompt).toContain(
			"Global behavior policy:\nStay direct.",
		);
		expect(prompt.systemPrompt).toContain("Instruction priority:");
		expect(prompt.systemPrompt).toContain("Assistant display name: Ava");
		expect(prompt.systemPrompt).toContain("Runtime context:");
		expect(prompt.systemPrompt).toContain("- Day transition. Day 2. Day 2");
		expect(prompt.systemPrompt).toContain("- Scene. Rain at the window.");
		expect(prompt.systemPrompt).toContain(
			"- Runtime state. Visible state note.",
		);
		expect(prompt.systemPrompt).not.toContain("Hidden state");
		expect(prompt.systemPrompt).toContain("Earlier durable context.");
		expect(prompt.systemPrompt).toContain(
			"Optional response tactics for this turn:",
		);
		expect(prompt.systemPrompt).toContain("Tactic: Calm down");
		expect(prompt.systemPrompt).toContain("Structured output contract:");
		expect(prompt.systemPrompt).toContain(
			"messages must contain normal assistant speech only.",
		);
	});

	it("keeps empty optional sections out while still stating current runtime day", async () => {
		const { assembleChatPrompt } = await import(
			"../../src/server/promptAssembly"
		);
		const prompt = assembleChatPrompt({
			globalSystemPrompt: "Be useful.",
			profile,
			clock,
			timeline: [],
			tactics: [],
		});

		expect(prompt.messages).toEqual([]);
		expect(prompt.systemPrompt).toContain("Current day: Day 2.");
		expect(prompt.systemPrompt).not.toContain("Earlier conversation context");
		expect(prompt.systemPrompt).not.toContain("Tactic:");
	});
});

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
