import { describe, expect, it } from "vitest";
import type { VioloopConfig } from "../../src/shared/types";
import {
	formatCacheHit,
	formatToken,
	timelineContentClassName,
	timelineItemClassName,
	timelineSpeaker,
	timelineSpeakerClassName,
} from "../../src/web/entities/message";
import {
	defaultNewChatDraft,
	toSessionProfile,
} from "../../src/web/entities/session";
import {
	fromSettingsDraft,
	toSettingsDraft,
} from "../../src/web/features/config-settings";
import {
	activeModelOptions,
	fromProviderEditorDraft,
	newProviderEditorDraft,
	providerEntries,
	slugifyProviderName,
	toProviderEditorDraft,
} from "../../src/web/features/provider-management";
import {
	fromTacticEditorDraft,
	newTacticEditorDraft,
	slugifyTacticName,
	toTacticEditorDraft,
} from "../../src/web/features/tactic-management";
import {
	normalizeSingleLine,
	splitCommaList,
} from "../../src/web/shared/lib/text";

function baseConfig(): VioloopConfig {
	return {
		chat: {
			defaultProvider: "beta",
			defaultModel: "model-b",
			systemPrompt: "System",
			temperature: 0.2,
			thinkingLevel: "high",
			cache: { systemPrompt: true, promptCacheRetention: "24h" },
			compaction: { enabled: true, triggerTokens: 100, keepRecentTokens: 20 },
		},
		providers: {
			beta: {
				name: "Beta",
				baseUrl: "http://b",
				api: "openai-completions",
				models: [{ id: "model-a", name: "A" }, { id: "model-b" }],
				compat: { supportsDeveloperRole: true },
			},
			alpha: {
				baseUrl: "http://a",
				api: "openai-completions",
			},
		},
	};
}

describe("frontend config business logic", () => {
	it("normalizes new chat profile without leaking blank fields", () => {
		expect(defaultNewChatDraft()).toEqual({
			assistantName: "Violoop",
			userRole: "The user is asking for practical help.",
			assistantRole: "A concise assistant that answers directly.",
		});
		expect(
			toSessionProfile({
				assistantName: "  Ava\nLoop ",
				userRole: " ",
				assistantRole: "Guide\tquietly",
			}),
		).toEqual({
			assistantName: "Ava Loop",
			userRole: "The user is asking for practical help.",
			assistantRole: "Guide quietly",
		});
		expect(normalizeSingleLine(" \n ", "fallback")).toBe("fallback");
	});

	it("round-trips tactic editor drafts and keeps generated ids stable for existing tactics", () => {
		expect(newTacticEditorDraft()).toMatchObject({
			id: "new-tactic",
			originalId: null,
			name: "New tactic",
		});
		expect(slugifyTacticName("  Recover!! After   Correction  ")).toBe(
			"recover-after-correction",
		);
		expect(slugifyTacticName("!!!")).toBe("new-tactic");
		expect(splitCommaList(" a, , b ,, c ")).toEqual(["a", "b", "c"]);

		const draft = toTacticEditorDraft({
			id: "recover",
			name: "Recover",
			allowedInSession: true,
			requiredStateIds: ["frustration"],
			keywords: ["no", "wrong"],
			emotionRules: [{ key: "frustration", operator: ">=", value: 55 }],
			blockedKeywords: ["new topic"],
			instruction: " Reset ",
		});
		expect(draft).toMatchObject({
			originalId: "recover",
			keywords: "no, wrong",
			blockedKeywords: "new topic",
		});
		expect(
			fromTacticEditorDraft({
				...draft,
				emotionRules: [
					...draft.emotionRules,
					{ key: "urgency", operator: "<=", value: "bad" },
				],
			}),
		).toEqual({
			id: "recover",
			name: "Recover",
			keywords: ["no", "wrong"],
			emotionRules: [{ key: "frustration", operator: ">=", value: 55 }],
			blockedKeywords: ["new topic"],
			instruction: "Reset",
		});
		expect(
			fromTacticEditorDraft({ ...newTacticEditorDraft(), name: "New Skill" })
				.id,
		).toBe("new-skill");
	});

	it("turns settings into an editable draft and back into config", () => {
		const draft = toSettingsDraft(baseConfig());
		expect(draft).toMatchObject({
			defaultModel: "model-b",
			temperature: "0.2",
			thinkingLevel: "high",
			systemPromptCache: true,
			compactionTriggerTokens: "100",
		});
		const next = fromSettingsDraft(baseConfig(), {
			...draft,
			defaultModel: "model-a",
			temperature: "0.8",
			thinkingLevel: "xhigh",
			systemPromptCache: false,
			compactionEnabled: false,
			compactionTriggerTokens: "200",
			compactionKeepRecentTokens: "40",
		});
		expect(next.chat).toMatchObject({
			defaultModel: "model-a",
			temperature: 0.8,
			thinkingLevel: "xhigh",
			cache: { systemPrompt: false, promptCacheRetention: "24h" },
			compaction: { enabled: false, triggerTokens: 200, keepRecentTokens: 40 },
		});
		expect(
			toSettingsDraft({
				...baseConfig(),
				chat: {
					...baseConfig().chat,
					temperature: undefined,
					thinkingLevel: undefined,
					cache: undefined,
				},
			}),
		).toMatchObject({
			temperature: "0.7",
			thinkingLevel: "off",
			systemPromptCache: false,
		});
	});

	it("sorts providers and builds active model options for configured and ad hoc models", () => {
		expect(providerEntries(baseConfig()).map(([id]) => id)).toEqual([
			"alpha",
			"beta",
		]);
		expect(activeModelOptions(baseConfig())).toEqual([
			{ label: "A", value: "model-a" },
			{ label: "model-b", value: "model-b" },
		]);
		const adHoc = {
			...baseConfig(),
			chat: { ...baseConfig().chat, defaultModel: "model-x" },
		};
		expect(activeModelOptions(adHoc)[0]).toEqual({
			label: "model-x",
			value: "model-x",
		});
		const noProvider = {
			...baseConfig(),
			chat: { ...baseConfig().chat, defaultProvider: "missing" },
		};
		expect(activeModelOptions(noProvider)).toEqual([
			{ label: "model-b", value: "model-b" },
		]);
	});

	it("round-trips provider editor drafts and rejects incomplete providers", () => {
		expect(newProviderEditorDraft()).toMatchObject({
			id: "new-provider",
			name: "New provider",
			authHeader: true,
		});
		expect(slugifyProviderName("!!!")).toBe("new-provider");

		const provider = baseConfig().providers.beta;
		expect(
			toProviderEditorDraft("alpha", baseConfig().providers.alpha),
		).toMatchObject({
			originalId: "alpha",
			id: "alpha",
			name: "alpha",
			models: "",
			apiKey: "",
			authHeader: true,
			supportsDeveloperRole: false,
			supportsUsageInStreaming: true,
			supportsReasoningEffort: false,
			thinkingFormat: "",
			cacheControlFormat: "",
		});
		const draft = toProviderEditorDraft("beta", {
			...provider,
			apiKey: "secret",
			authHeader: false,
			compat: {
				supportsDeveloperRole: true,
				supportsUsageInStreaming: false,
				supportsReasoningEffort: true,
				thinkingFormat: "openrouter",
				cacheControlFormat: "anthropic",
			},
		});
		expect(draft).toMatchObject({
			originalId: "beta",
			name: "Beta",
			models: "model-a, model-b",
			apiKey: "secret",
			authHeader: false,
			thinkingFormat: "openrouter",
			cacheControlFormat: "anthropic",
		});

		expect(
			fromProviderEditorDraft({
				...draft,
				name: "  Beta Provider ",
				baseUrl: " http://next/ ",
				models: " one, two ",
				apiKey: " ",
				thinkingFormat: "",
				cacheControlFormat: "",
			}),
		).toMatchObject({
			name: "Beta Provider",
			baseUrl: "http://next/",
			api: "openai-completions",
			apiKey: undefined,
			models: [
				{ id: "one", name: "one" },
				{ id: "two", name: "two" },
			],
			compat: {
				supportsDeveloperRole: true,
				supportsUsageInStreaming: false,
				supportsReasoningEffort: true,
				thinkingFormat: undefined,
				cacheControlFormat: undefined,
			},
		});
		expect(() => fromProviderEditorDraft({ ...draft, name: " " })).toThrow(
			"Provider name is required",
		);
		expect(() => fromProviderEditorDraft({ ...draft, baseUrl: " " })).toThrow(
			"Provider base URL is required",
		);
		expect(() => fromProviderEditorDraft({ ...draft, models: " , " })).toThrow(
			"At least one model is required",
		);
	});

	it("maps timeline messages into speaker labels and visual categories", () => {
		const base = {
			id: "m1",
			conversationId: "c1",
			content: "Hello",
			promptVisibility: "visible" as const,
			createdAt: "2026-01-01T00:00:00.000Z",
		};
		const profile = {
			assistantName: "Ava",
			userRole: "User",
			assistantRole: "Assistant",
		};

		expect(formatCacheHit({})).toBe("cache n/a");
		expect(formatCacheHit({ cacheHitRate: 0.456 })).toBe("46% cache hit");
		expect(formatToken(undefined)).toBe("n/a");
		expect(formatToken(1200)).toBe("1,200");

		const day = {
			...base,
			kind: "day_transition" as const,
			role: "system" as const,
		};
		const scene = { ...base, kind: "scene" as const, role: "system" as const };
		const state = {
			...base,
			kind: "state_update" as const,
			role: "system" as const,
		};
		const user = { ...base, kind: "chat" as const, role: "user" as const };
		const assistant = {
			...base,
			kind: "chat" as const,
			role: "assistant" as const,
		};
		const named = { ...assistant, speakerName: "Guide" };

		expect(timelineSpeaker(day, profile)).toBe("Day");
		expect(timelineSpeaker(scene, profile)).toBe("Scene");
		expect(timelineSpeaker(named, profile)).toBe("Guide");
		expect(timelineSpeaker(user, profile)).toBe("You");
		expect(timelineSpeaker(assistant, profile)).toBe("Ava");
		expect(timelineItemClassName(day)).toContain("justify-center");
		expect(timelineItemClassName(scene)).toContain("grid");
		expect(timelineItemClassName(state)).toContain("text-neutral-500");
		expect(timelineItemClassName(user)).toContain("items-end");
		expect(timelineItemClassName(assistant)).toContain("items-start");
		expect(timelineSpeakerClassName(day)).toBe("sr-only");
		expect(timelineSpeakerClassName(scene)).toContain("uppercase");
		expect(timelineSpeakerClassName(user)).toContain("uppercase");
		expect(timelineSpeakerClassName(assistant)).toContain("uppercase");
		expect(timelineContentClassName(day)).toContain("text-center");
		expect(timelineContentClassName(scene)).toContain("text-neutral-700");
		expect(timelineContentClassName(state)).toContain("text-neutral-500");
		expect(timelineContentClassName(user)).toContain("bg-neutral-100");
		expect(timelineContentClassName(assistant)).toContain("bg-white");
	});
});
