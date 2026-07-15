import type {
	AppConfigSnapshot,
	ChatUsage,
	ProviderConfig,
	VioloopConfig,
} from "../../src/shared/types";

/** Provider config for the "https://provider.example" family used by local storage/runtime tests. */
export function createProviderConfig(
	overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
	return {
		baseUrl: "https://provider.example/v1",
		api: "openai-completions",
		apiKey: "secret",
		models: [{ id: "model-a" }],
		...overrides,
	};
}

/** VioloopConfig for the "local" provider family used by local storage/runtime tests. */
export function createVioloopConfig(
	overrides: {
		chat?: Partial<VioloopConfig["chat"]>;
		providers?: VioloopConfig["providers"];
	} = {},
): VioloopConfig {
	return {
		chat: {
			defaultProvider: "local",
			defaultModel: "model-a",
			systemPrompt: "System",
			compaction: {
				enabled: true,
				triggerTokens: 1000,
				keepRecentTokens: 100,
			},
			...overrides.chat,
		},
		providers: overrides.providers ?? { local: createProviderConfig() },
	};
}

/** Provider config for the "http://provider.test" family used by web-layer tests. */
export function createWebProviderConfig(
	overrides: Partial<ProviderConfig> = {},
): ProviderConfig {
	return {
		name: "Local",
		baseUrl: "http://provider.test",
		api: "openai-completions",
		models: [{ id: "model-a" }],
		...overrides,
	};
}

/** VioloopConfig for web-layer tests (config workflow, provider workflow, api facades). */
export function createWebVioloopConfig(
	overrides: {
		chat?: Partial<VioloopConfig["chat"]>;
		providers?: VioloopConfig["providers"];
	} = {},
): VioloopConfig {
	return {
		chat: {
			defaultProvider: "local",
			defaultModel: "model-a",
			systemPrompt: "System",
			temperature: 0.7,
			thinkingLevel: "off",
			compaction: {
				enabled: true,
				triggerTokens: 1000,
				keepRecentTokens: 100,
			},
			...overrides.chat,
		},
		providers: overrides.providers ?? { local: createWebProviderConfig() },
	};
}

export function createAppConfigSnapshot(
	overrides: Partial<AppConfigSnapshot> = {},
	configOverrides?: Parameters<typeof createWebVioloopConfig>[0],
): AppConfigSnapshot {
	const config = overrides.config ?? createWebVioloopConfig(configOverrides);
	return {
		provider: "local",
		providerName: "Local",
		baseUrl: "http://provider.test",
		api: "openai-completions",
		model: "model-a",
		cache: { systemPrompt: true, usageInStreaming: true },
		...overrides,
		config,
	};
}

export function createChatUsage(overrides: Partial<ChatUsage> = {}): ChatUsage {
	return {
		promptTokens: 10,
		cachedPromptTokens: 5,
		completionTokens: 4,
		...overrides,
	};
}
