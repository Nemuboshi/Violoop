import { describe, expect, it } from "vitest";
import { scoreTactic } from "../../src/shared/domain/tactics";
import type { UserState } from "../../src/shared/types";

const states: UserState[] = [
	{
		key: "trust",
		value: 50,
		source: "explicit",
		confidence: 1,
		updatedAt: "2026-01-01T00:00:00.000Z",
	},
];

describe("scoreTactic", () => {
	it("scores keywords, emotion rules, and blocked keywords", () => {
		expect(
			scoreTactic(
				{
					id: "calm",
					name: "Calm",
					keywords: ["please"],
					emotionRules: [{ key: "trust", operator: ">=", value: 40 }],
					blockedKeywords: ["panic"],
				},
				"please help",
				states,
			),
		).toMatchObject({
			loaded: true,
			decision: "loaded",
			matchedKeywords: ["please"],
		});

		expect(
			scoreTactic(
				{
					id: "low",
					name: "Low",
					keywords: [],
					emotionRules: [{ key: "trust", operator: "<=", value: 60 }],
					blockedKeywords: [],
				},
				"hello",
				states,
			),
		).toMatchObject({
			loaded: true,
			reasons: expect.arrayContaining([
				expect.stringContaining("matched emotion rules"),
			]),
		});

		expect(
			scoreTactic(
				{
					id: "blocked",
					name: "Blocked",
					keywords: ["please"],
					emotionRules: [],
					blockedKeywords: ["panic"],
				},
				"please panic",
				states,
			),
		).toMatchObject({
			loaded: false,
			contraindications: ["panic"],
		});

		expect(
			scoreTactic(
				{
					id: "miss",
					name: "Miss",
					keywords: ["never"],
					emotionRules: [{ key: "missing", operator: ">=", value: 1 }],
					blockedKeywords: [],
				},
				"hello",
				states,
			),
		).toMatchObject({
			loaded: false,
			reasons: ["no trigger matched"],
		});
	});
});
