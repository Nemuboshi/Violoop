import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type {
	ActiveProvider,
	ProviderConfig,
	ProviderModelConfig,
	VioloopConfig,
} from "../shared/types";
import { getServerPaths } from "./serverContext";

const providerApiSchema = z.literal("openai-completions");
const thinkingLevelSchema = z.enum([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);
const thinkingFormatSchema = z.enum([
	"openai",
	"openrouter",
	"qwen",
	"qwen-chat-template",
	"deepseek",
	"together",
	"zai",
	"string-thinking",
]);

const providerCompatSchema = z.strictObject({
	supportsDeveloperRole: z.boolean().optional(),
	supportsUsageInStreaming: z.boolean().optional(),
	cacheControlFormat: z.literal("anthropic").optional(),
	supportsLongCacheRetention: z.boolean().optional(),
	supportsReasoningEffort: z.boolean().optional(),
	thinkingFormat: thinkingFormatSchema.optional(),
});

const providerModelSchema = z.strictObject({
	id: z.string().min(1),
	name: z.string().min(1).optional(),
	api: providerApiSchema.optional(),
	reasoning: z.boolean().optional(),
	thinkingLevelMap: z.record(z.string(), z.string().nullable()).optional(),
	compat: providerCompatSchema.optional(),
});

const providerSchema = z.strictObject({
	name: z.string().min(1).optional(),
	baseUrl: z.string().min(1),
	api: providerApiSchema,
	apiKey: z.string().optional(),
	authHeader: z.boolean().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	models: z.array(providerModelSchema).optional(),
	compat: providerCompatSchema.optional(),
});

const configSchema = z
	.strictObject({
		chat: z.strictObject({
			defaultProvider: z.string().min(1),
			defaultModel: z.string().min(1),
			systemPrompt: z.string().min(1),
			temperature: z.number().optional(),
			thinkingLevel: thinkingLevelSchema.optional(),
			cache: z
				.strictObject({
					systemPrompt: z.boolean().optional(),
					promptCacheRetention: z.string().optional(),
				})
				.optional(),
			compaction: z.strictObject({
				enabled: z.boolean(),
				triggerTokens: z.number().int().positive(),
				keepRecentTokens: z.number().int().positive(),
			}),
		}),
		providers: z.record(z.string(), providerSchema),
	})
	.superRefine((config, context) => {
		const provider = config.providers[config.chat.defaultProvider];
		if (!provider) {
			context.addIssue({
				code: "custom",
				path: ["chat", "defaultProvider"],
				message: `Provider "${config.chat.defaultProvider}" is not configured.`,
			});
			return;
		}

		const hasModel = (provider.models ?? []).some(
			(model) => model.id === config.chat.defaultModel,
		);
		if ((provider.models?.length ?? 0) > 0 && !hasModel) {
			context.addIssue({
				code: "custom",
				path: ["chat", "defaultModel"],
				message: `Model "${config.chat.defaultModel}" is not configured for provider "${config.chat.defaultProvider}".`,
			});
		}

		if (
			config.chat.compaction.enabled &&
			config.chat.compaction.keepRecentTokens >=
				config.chat.compaction.triggerTokens
		) {
			context.addIssue({
				code: "custom",
				path: ["chat", "compaction", "keepRecentTokens"],
				message:
					"Config chat.compaction.keepRecentTokens must be lower than triggerTokens.",
			});
		}
	});

export async function initializeConfigStore() {
	const path = getServerPaths().settingsPath;
	await mkdir(dirname(path), { recursive: true });

	try {
		await readFile(path, "utf8");
	} catch (error) {
		if (isNotFoundError(error)) {
			throw new Error(
				"Missing data/settings.json. Run `pnpm seed` or create the settings file before starting the server.",
			);
		}
		throw error;
	}
}

export async function loadConfig(): Promise<VioloopConfig> {
	const raw = await readFile(getServerPaths().settingsPath, "utf8");
	return configSchema.parse(JSON.parse(raw)) as VioloopConfig;
}

export async function saveConfig(
	config: VioloopConfig,
): Promise<VioloopConfig> {
	const parsed = configSchema.parse(config) as VioloopConfig;
	await writeJson(getServerPaths().settingsPath, parsed);
	return parsed;
}

export function resolveActiveProvider(config: VioloopConfig): ActiveProvider {
	const providerId = config.chat.defaultProvider;
	const provider = config.providers[providerId];

	if (!provider) {
		throw new Error(`Provider "${providerId}" is not configured.`);
	}

	const model = resolveModel(provider, config.chat.defaultModel);
	const api = model.api ?? provider.api;
	const providerCompat = provider.compat ?? {};
	const modelCompat = model.compat ?? {};

	return {
		id: providerId,
		name: provider.name ?? providerId,
		baseUrl: stripTrailingSlash(provider.baseUrl),
		api,
		model,
		apiKey: provider.apiKey,
		authHeader: provider.authHeader ?? true,
		headers: provider.headers ?? {},
		compat: { ...providerCompat, ...modelCompat },
	};
}

function resolveModel(
	provider: ProviderConfig,
	modelId: string,
): ProviderModelConfig {
	const model = provider.models?.find((item) => item.id === modelId);
	return model ?? { id: modelId, api: provider.api };
}

async function writeJson(path: string, value: unknown) {
	await mkdir(dirname(path), { recursive: true });
	const tempPath = `${path}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	await rename(tempPath, path);
}

function stripTrailingSlash(value: string) {
	return value.replace(/\/+$/, "");
}

function isNotFoundError(error: unknown) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
