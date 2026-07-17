import type {
	ProviderConfig,
	ProviderTransport,
	ThinkingFormat,
	VioloopConfig,
} from "../../../../shared/types";
import {
	normalizeSingleLine,
	slugifyName,
	splitCommaList,
} from "../../../shared/lib";

export type ProviderEditorDraft = {
	originalId: string | null;
	id: string;
	name: string;
	baseUrl: string;
	models: string;
	apiKey: string;
	authHeader: boolean;
	supportsDeveloperRole: boolean;
	supportsUsageInStreaming: boolean;
	supportsReasoningEffort: boolean;
	thinkingFormat: "" | ThinkingFormat;
	cacheControlFormat: "" | "anthropic";
	transport: ProviderTransport;
};

type ProviderConfigWithModels = ProviderConfig & {
	models: NonNullable<ProviderConfig["models"]>;
};

export const transportOptions: Array<{
	label: string;
	value: ProviderTransport;
}> = [
	{ label: "Worker proxy (clean CORS)", value: "worker" },
	{ label: "Browser direct (home IP; requires CORS)", value: "browser" },
	{
		label: "Browser direct, then Worker proxy",
		value: "browser-fallback-worker",
	},
	{
		label: "Worker proxy, then browser direct",
		value: "worker-fallback-browser",
	},
];

export const thinkingFormatOptions: Array<{
	label: string;
	value: ProviderEditorDraft["thinkingFormat"];
}> = [
	{ label: "None", value: "" },
	{ label: "OpenAI reasoning_effort", value: "openai" },
	{ label: "OpenRouter reasoning.effort", value: "openrouter" },
	{ label: "Qwen enable_thinking", value: "qwen" },
	{ label: "Qwen chat_template_kwargs", value: "qwen-chat-template" },
	{ label: "DeepSeek thinking", value: "deepseek" },
	{ label: "Together reasoning", value: "together" },
	{ label: "ZAI thinking", value: "zai" },
	{ label: "String thinking", value: "string-thinking" },
];

export function providerEntries(config: VioloopConfig) {
	return Object.entries(config.providers).sort(([leftId], [rightId]) =>
		leftId.localeCompare(rightId),
	);
}

export function activeModelOptions(config: VioloopConfig) {
	const provider = config.providers[config.chat.defaultProvider];
	const models = provider?.models ?? [];
	const options = models.map((model) => ({
		label: model.name ?? model.id,
		value: model.id,
	}));
	if (!options.some((option) => option.value === config.chat.defaultModel)) {
		options.unshift({
			label: config.chat.defaultModel,
			value: config.chat.defaultModel,
		});
	}
	return options;
}

export function newProviderEditorDraft(): ProviderEditorDraft {
	return {
		originalId: null,
		id: slugifyProviderName("New provider"),
		name: "New provider",
		baseUrl: "",
		models: "",
		apiKey: "",
		authHeader: true,
		supportsDeveloperRole: false,
		supportsUsageInStreaming: true,
		supportsReasoningEffort: false,
		thinkingFormat: "",
		cacheControlFormat: "",
		transport: "worker",
	};
}

export function toProviderEditorDraft(
	providerId: string,
	provider: ProviderConfig,
): ProviderEditorDraft {
	return {
		originalId: providerId,
		id: providerId,
		name: provider.name ?? providerId,
		baseUrl: provider.baseUrl,
		models: provider.models?.map((model) => model.id).join(", ") ?? "",
		apiKey: provider.apiKey ?? "",
		authHeader: provider.authHeader ?? true,
		supportsDeveloperRole: provider.compat?.supportsDeveloperRole ?? false,
		supportsUsageInStreaming: provider.compat?.supportsUsageInStreaming ?? true,
		supportsReasoningEffort: provider.compat?.supportsReasoningEffort ?? false,
		thinkingFormat: provider.compat?.thinkingFormat ?? "",
		cacheControlFormat: provider.compat?.cacheControlFormat ?? "",
		transport: provider.transport ?? "worker",
	};
}

export function fromProviderEditorDraft(
	draft: ProviderEditorDraft,
	previousProvider?: ProviderConfig,
): ProviderConfigWithModels {
	const models = splitCommaList(draft.models);
	if (!draft.name.trim()) {
		throw new Error("Provider name is required.");
	}

	if (!draft.baseUrl.trim()) {
		throw new Error("Provider base URL is required.");
	}

	if (models.length === 0) {
		throw new Error("At least one model is required.");
	}

	return {
		...(previousProvider ?? {}),
		name: normalizeSingleLine(draft.name, draft.id),
		baseUrl: draft.baseUrl.trim(),
		api: "openai-completions",
		apiKey: draft.apiKey.trim() || undefined,
		authHeader: draft.authHeader,
		transport: draft.transport,
		models: models.map((model) => ({ id: model, name: model })),
		compat: {
			...(previousProvider?.compat ?? {}),
			supportsDeveloperRole: draft.supportsDeveloperRole,
			supportsUsageInStreaming: draft.supportsUsageInStreaming,
			supportsReasoningEffort: draft.supportsReasoningEffort,
			thinkingFormat: draft.thinkingFormat || undefined,
			cacheControlFormat: draft.cacheControlFormat || undefined,
		},
	};
}

export function slugifyProviderName(value: string) {
	return slugifyName(value, "new-provider");
}
