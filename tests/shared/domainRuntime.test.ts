import { describe, expect, it } from "vitest";
import {
	applyStatePatchValues,
	buildCompactionGuidance,
	estimateContextTokens,
	formatCompactionPrompt,
	parseStructuredChatResult,
	sanitizeRuntimeText,
	sanitizeStatePatches,
	splitMessagesForCompaction,
	stripTimelineMarkers,
	toPromptTimeline,
} from "../../src/shared/domain/runtime";
import type {
	StoredCompaction,
	TimelineItem,
	UserState,
} from "../../src/shared/types";

function item(
	overrides: Partial<TimelineItem> & Pick<TimelineItem, "id" | "content">,
): TimelineItem {
	return {
		conversationId: "c1",
		kind: "chat",
		role: "user",
		promptVisibility: "visible",
		createdAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

describe("shared domain runtime", () => {
	it("parses structured chat results and falls back for plain text", () => {
		expect(
			parseStructuredChatResult(
				'{"messages":[{"kind":"chat","content":"Hi"}],"runtimeActions":[{"tool":"advance_day"}]}',
			),
		).toMatchObject({
			messages: [{ content: "Hi" }],
			runtimeActions: [{ tool: "advance_day" }],
		});
		expect(parseStructuredChatResult("plain answer")).toMatchObject({
			messages: [{ content: "plain answer" }],
		});
		expect(parseStructuredChatResult("{bad json")).toMatchObject({
			messages: [{ content: "{bad json" }],
		});
		expect(parseStructuredChatResult('{ "broken": }')).toMatchObject({
			messages: [{ content: '{ "broken": }' }],
		});
		expect(
			parseStructuredChatResult('{"messages":[{"kind":"tool","content":"x"}]}'),
		).toMatchObject({ messages: [] });
		expect(
			parseStructuredChatResult('{"runtimeActions":[{"tool":"ignored"}]}'),
		).toMatchObject({ runtimeActions: [] });
		expect(parseStructuredChatResult('{"other":true}')).toMatchObject({
			messages: [{ content: '{"other":true}' }],
		});
	});

	it("strips timeline markers and sanitizes runtime text", () => {
		expect(stripTimelineMarkers("[scene]\nHello")).toBe("Hello");
		expect(sanitizeRuntimeText("  spaced  ", 4)).toBe("spac");
		expect(sanitizeRuntimeText(null, 10)).toBe("");
	});

	it("projects prompt timelines from compaction summaries", () => {
		const timeline = [
			item({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" }),
			item({ id: "b", createdAt: "2026-01-02T00:00:00.000Z" }),
			item({ id: "c", createdAt: "2026-01-03T00:00:00.000Z" }),
		];
		const summary = {
			id: "cmp",
			conversationId: "c1",
			summary: "Earlier context",
			firstKeptMessageId: "b",
			coveredMessageIds: ["a"],
			tokenEstimate: 10,
			createdAt: "2026-01-01T12:00:00.000Z",
			model: "model-a",
		} satisfies StoredCompaction;
		expect(toPromptTimeline(timeline)).toEqual(timeline);
		expect(toPromptTimeline(timeline, summary)).toEqual(timeline.slice(1));
		expect(
			toPromptTimeline(timeline, {
				...summary,
				firstKeptMessageId: "missing",
			}),
		).toEqual(timeline.slice(1));
		expect(
			toPromptTimeline(timeline, {
				id: "cmp2",
				conversationId: "c1",
				summary: "Earlier context",
				coveredMessageIds: ["a"],
				tokenEstimate: 10,
				createdAt: "2026-01-01T12:00:00.000Z",
				model: "model-a",
			}),
		).toEqual(timeline.slice(1));
	});

	it("estimates tokens and splits compaction windows", () => {
		const messages = [
			item({ id: "1", content: "a".repeat(40) }),
			item({ id: "2", content: "b".repeat(40) }),
			item({ id: "3", content: "c".repeat(40) }),
		];
		expect(estimateContextTokens(undefined, messages)).toBeGreaterThan(0);
		expect(
			estimateContextTokens(
				{
					id: "cmp",
					conversationId: "c1",
					summary: "summary",
					coveredMessageIds: [],
					tokenEstimate: 1,
					createdAt: "2026-01-01T00:00:00.000Z",
					model: "model-a",
				},
				messages,
			),
		).toBeGreaterThan(estimateContextTokens(undefined, messages));
		const split = splitMessagesForCompaction(messages, 20);
		expect(split.compact.length).toBeGreaterThan(0);
		expect(split.keep.length).toBeGreaterThan(0);
		expect(formatCompactionPrompt("old", split.compact)).toContain("old");
		expect(buildCompactionGuidance(undefined)).toBe("");
		expect(
			buildCompactionGuidance({
				id: "cmp",
				conversationId: "c1",
				summary: "summary text",
				coveredMessageIds: [],
				tokenEstimate: 1,
				createdAt: "2026-01-01T00:00:00.000Z",
				model: "model-a",
			}),
		).toContain("summary text");
	});

	it("sanitizes and applies bounded state patches", () => {
		const states: UserState[] = [
			{
				key: "trust",
				value: 50,
				source: "explicit",
				confidence: 1,
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		];
		expect(sanitizeStatePatches(states, "bad")).toEqual([]);
		expect(
			sanitizeStatePatches(states, [
				{ key: "trust", delta: 20 },
				{ key: "trust", delta: 1 },
				{ key: "missing", delta: 1 },
				{ key: "", delta: 1 },
				null,
			]),
		).toEqual([
			expect.objectContaining({ key: "trust", delta: 10, reason: "" }),
		]);
		const applied = applyStatePatchValues(states, [
			{ key: "trust", delta: 5, reason: "warmer" },
		]);
		expect(applied).toEqual([
			expect.objectContaining({
				key: "trust",
				nextValue: 55,
				reason: "warmer",
			}),
		]);
		expect(states[0].value).toBe(55);
	});
});
