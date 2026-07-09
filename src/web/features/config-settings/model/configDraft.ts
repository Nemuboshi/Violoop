import type { ThinkingLevel, VioloopConfig } from "../../../../shared/types";

export type ChatSettingsDraft = {
	defaultModel: string;
	systemPrompt: string;
	temperature: string;
	thinkingLevel: ThinkingLevel;
	systemPromptCache: boolean;
	compactionEnabled: boolean;
	compactionTriggerTokens: string;
	compactionKeepRecentTokens: string;
};

export const thinkingLevelOptions: Array<{
	label: string;
	value: ThinkingLevel;
}> = [
	{ label: "Off", value: "off" },
	{ label: "Minimal", value: "minimal" },
	{ label: "Low", value: "low" },
	{ label: "Medium", value: "medium" },
	{ label: "High", value: "high" },
	{ label: "Extra high", value: "xhigh" },
];

export function isThinkingLevel(value: string): value is ThinkingLevel {
	return thinkingLevelOptions.some((option) => option.value === value);
}

export function toSettingsDraft(config: VioloopConfig): ChatSettingsDraft {
	return {
		defaultModel: config.chat.defaultModel,
		systemPrompt: config.chat.systemPrompt,
		temperature: String(config.chat.temperature ?? 0.7),
		thinkingLevel: config.chat.thinkingLevel ?? "off",
		systemPromptCache: config.chat.cache?.systemPrompt ?? false,
		compactionEnabled: config.chat.compaction.enabled,
		compactionTriggerTokens: String(config.chat.compaction.triggerTokens),
		compactionKeepRecentTokens: String(config.chat.compaction.keepRecentTokens),
	};
}

export function fromSettingsDraft(
	baseConfig: VioloopConfig,
	draft: ChatSettingsDraft,
): VioloopConfig {
	return {
		...baseConfig,
		chat: {
			...baseConfig.chat,
			defaultModel: draft.defaultModel,
			systemPrompt: draft.systemPrompt,
			temperature: Number(draft.temperature),
			thinkingLevel: draft.thinkingLevel,
			cache: {
				...baseConfig.chat.cache,
				systemPrompt: draft.systemPromptCache,
			},
			compaction: {
				enabled: draft.compactionEnabled,
				triggerTokens: Number(draft.compactionTriggerTokens),
				keepRecentTokens: Number(draft.compactionKeepRecentTokens),
			},
		},
	};
}
