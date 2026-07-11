import { z } from "zod";
import {
	compactionSchema,
	conversationSchema,
	sessionClockSchema,
	stateDefinitionSchema,
	tacticRunSchema,
	tacticSchema,
	timelineItemSchema,
	userStateSchema,
} from "../../../shared/domain/runtime";
import type { ProviderConfig, VioloopConfig } from "../../../shared/types";
import {
	getConfig,
	getSessionClockLocal,
	getSessionTacticIdsLocal,
	getSessionUserStateLocal,
	listCompactionsLocal,
	listConversationsLocal,
	listStateDefinitionsLocal,
	listTacticRunsLocal,
	listTacticsLocal,
	listTimelineItemsLocal,
	listUsageLocal,
} from "./repository";

const providerModelSchema = z.object({
	id: z.string().min(1),
	name: z.string().optional(),
	api: z.literal("openai-completions").optional(),
	reasoning: z.boolean().optional(),
	thinkingLevelMap: z.record(z.string(), z.string().nullable()).optional(),
	compat: z.record(z.string(), z.unknown()).optional(),
});
const providerSchema = z.object({
	name: z.string().optional(),
	baseUrl: z.string().min(1),
	api: z.literal("openai-completions"),
	authHeader: z.boolean().optional(),
	headers: z.record(z.string(), z.string()).optional(),
	models: z.array(providerModelSchema).optional(),
	compat: z.record(z.string(), z.unknown()).optional(),
});
const configSchema = z.object({
	chat: z.object({
		defaultProvider: z.string().min(1),
		defaultModel: z.string().min(1),
		systemPrompt: z.string(),
		temperature: z.number().finite().optional(),
		thinkingLevel: z.string().optional(),
		cache: z.record(z.string(), z.unknown()).optional(),
		compaction: z.object({
			enabled: z.boolean(),
			triggerTokens: z.number().positive(),
			keepRecentTokens: z.number().positive(),
		}),
	}),
	providers: z.record(z.string(), providerSchema),
});

export const importedConversationSchema = z.object({
	conversation: conversationSchema,
	timelineItems: z.array(timelineItemSchema),
	compactions: z.array(compactionSchema),
	clock: sessionClockSchema.optional(),
	tacticIds: z.array(z.string()),
	userState: z.array(userStateSchema),
	tacticRuns: z.array(tacticRunSchema),
});

export const exportSchema = z.object({
	format: z.literal("violoop-export"),
	schemaVersion: z.literal(1),
	exportedAt: z.string(),
	config: configSchema,
	providers: z.record(z.string(), providerSchema),
	tactics: z.array(tacticSchema),
	stateDefinitions: z.array(stateDefinitionSchema),
	conversations: z.array(importedConversationSchema),
	usage: z
		.array(
			z.strictObject({
				requestId: z.string().min(1),
				usage: z.object({
					promptTokens: z.number().finite().optional(),
					completionTokens: z.number().finite().optional(),
					totalTokens: z.number().finite().optional(),
					cachedPromptTokens: z.number().finite().optional(),
					cacheHitRate: z.number().finite().optional(),
				}),
			}),
		)
		.optional()
		.default([]),
});

export type VioloopExport = z.infer<typeof exportSchema>;

export async function exportLocalData(): Promise<VioloopExport> {
	const config = await getConfig();
	const conversations = await listConversationsLocal();
	const providers = redactProviders(config?.providers ?? {});
	return {
		format: "violoop-export",
		schemaVersion: 1,
		exportedAt: new Date().toISOString(),
		config: config ? { ...config, providers } : emptyConfig(),
		providers,
		tactics: await listTacticsLocal(),
		stateDefinitions: await listStateDefinitionsLocal(),
		conversations: await Promise.all(
			conversations.map(async (conversation) => ({
				conversation,
				timelineItems: await listTimelineItemsLocal(conversation.id),
				compactions: await listCompactionsLocal(conversation.id),
				clock: await getSessionClockLocal(conversation.id),
				tacticIds: await getSessionTacticIdsLocal(conversation.id),
				userState: (await getSessionUserStateLocal(conversation.id)) ?? [],
				tacticRuns: await listTacticRunsLocal(conversation.id),
			})),
		),
		usage: await listUsageLocal(),
	};
}

export function serializeExport(data: VioloopExport) {
	return `${JSON.stringify(data, null, 2)}\n`;
}

export function parseImport(text: string) {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error("Import file is not valid JSON.");
	}
	return exportSchema.parse(value);
}

function redactProviders(providers: Record<string, ProviderConfig>) {
	return Object.fromEntries(
		Object.entries(providers).map(([id, provider]) => {
			const { apiKey: _apiKey, ...safeProvider } = provider;
			return [id, safeProvider];
		}),
	);
}

function emptyConfig() {
	return {
		chat: {
			defaultProvider: "",
			defaultModel: "",
			systemPrompt: "",
			compaction: { enabled: false, triggerTokens: 1, keepRecentTokens: 1 },
		},
		providers: {},
	} satisfies VioloopConfig;
}
