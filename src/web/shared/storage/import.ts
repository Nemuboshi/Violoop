import { z } from "zod";
import type { VioloopConfig } from "../../../shared/types";
import { runLocalTransaction } from "./database";
import type { VioloopExport } from "./export";
import { importedConversationSchema } from "./export";
import {
	getConfig,
	listCompactionsLocal,
	listConversationsLocal,
	listStateDefinitionsLocal,
	listTacticRunsLocal,
	listTacticsLocal,
	listTimelineItemsLocal,
} from "./repository";

export type ImportConflictStrategy = "replace" | "keep-existing" | "skip";
export type ImportResult = {
	conversations: number;
	tactics: number;
	stateDefinitions: number;
	imported: number;
	skipped: number;
	replaced: number;
	preserved: number;
	strategy: ImportConflictStrategy;
};

export async function importLocalData(
	data: VioloopExport,
	options: { strategy?: ImportConflictStrategy } = {},
): Promise<ImportResult> {
	const strategy = options.strategy ?? "replace";
	const currentConfig = await getConfig();
	const currentConversations = await listConversationsLocal();
	const currentTactics = await listTacticsLocal();
	const currentStates = await listStateDefinitionsLocal();
	const existingConversationIds = new Set(
		currentConversations.map((item) => item.id),
	);
	const existingTacticIds = new Set(currentTactics.map((item) => item.id));
	const existingStateIds = new Set(currentStates.map((item) => item.id));
	const operations = [] as Parameters<typeof runLocalTransaction>[0];
	let imported = 0;
	let skipped = 0;
	let replaced = 0;
	let preserved = 0;
	const config = validateImportedConfig(data.config);
	if (
		config?.chat.defaultProvider &&
		!config.providers[config.chat.defaultProvider]
	) {
		throw new Error(
			"Import configuration references an unknown default provider.",
		);
	}
	validateCrossReferences(data, currentStates);
	if (config && Object.keys(config.providers).length > 0) {
		const nextConfig =
			strategy === "skip" && currentConfig
				? currentConfig
				: strategy === "keep-existing" && currentConfig
					? mergeConfigPreservingCurrent(currentConfig, config)
					: mergeConfig(currentConfig, config);
		operations.push({
			type: "put",
			storeName: "config",
			value: { id: "current", config: nextConfig },
		});
	}
	for (const tactic of data.tactics) {
		if (existingTacticIds.has(tactic.id)) {
			if (strategy === "replace") replaced++;
			else {
				skipped++;
				preserved++;
				continue;
			}
		}
		operations.push({ type: "put", storeName: "tactics", value: tactic });
		imported++;
	}
	for (const state of data.stateDefinitions) {
		if (existingStateIds.has(state.id)) {
			if (strategy === "replace") replaced++;
			else {
				skipped++;
				preserved++;
				continue;
			}
		}
		operations.push({
			type: "put",
			storeName: "stateDefinitions",
			value: state,
		});
		imported++;
	}
	for (const usage of data.usage ?? []) {
		operations.push({ type: "put", storeName: "usage", value: usage });
	}
	for (const importedConversation of data.conversations.map((item) =>
		importedConversationSchema.parse(item),
	)) {
		const id = importedConversation.conversation.id;
		if (existingConversationIds.has(id) && strategy === "skip") {
			skipped++;
			preserved++;
			continue;
		}
		if (existingConversationIds.has(id) && strategy === "keep-existing") {
			const [existingItems, existingCompactions, existingRuns] =
				await Promise.all([
					listTimelineItemsLocal(id),
					listCompactionsLocal(id),
					listTacticRunsLocal(id),
				]);
			const itemIds = new Set(existingItems.map((item) => item.id));
			const compactionIds = new Set(existingCompactions.map((item) => item.id));
			const runIds = new Set(existingRuns.map((run) => run.id));
			for (const item of importedConversation.timelineItems) {
				if (!itemIds.has(item.id))
					operations.push({
						type: "put",
						storeName: "timelineItems",
						value: item,
					});
			}
			for (const item of importedConversation.compactions) {
				if (!compactionIds.has(item.id))
					operations.push({
						type: "put",
						storeName: "compactions",
						value: item,
					});
			}
			for (const run of importedConversation.tacticRuns) {
				if (!runIds.has(run.id))
					operations.push({ type: "put", storeName: "tacticRuns", value: run });
			}
			skipped++;
			preserved++;
			continue;
		}
		if (existingConversationIds.has(id)) {
			replaced++;
			const [items, compactions, runs] = await Promise.all([
				listTimelineItemsLocal(id),
				listCompactionsLocal(id),
				listTacticRunsLocal(id),
			]);
			for (const item of items)
				operations.push({
					type: "delete",
					storeName: "timelineItems",
					key: item.id,
				});
			for (const item of compactions)
				operations.push({
					type: "delete",
					storeName: "compactions",
					key: item.id,
				});
			for (const item of runs)
				operations.push({
					type: "delete",
					storeName: "tacticRuns",
					key: item.id,
				});
			for (const storeName of [
				"sessionClocks",
				"sessionTactics",
				"sessionStates",
			] as const)
				operations.push({ type: "delete", storeName, key: id });
		}
		operations.push({
			type: "put",
			storeName: "conversations",
			value: importedConversation.conversation,
		});
		for (const item of importedConversation.timelineItems)
			operations.push({ type: "put", storeName: "timelineItems", value: item });
		for (const item of importedConversation.compactions)
			operations.push({ type: "put", storeName: "compactions", value: item });
		if (importedConversation.clock)
			operations.push({
				type: "put",
				storeName: "sessionClocks",
				value: importedConversation.clock,
			});
		operations.push({
			type: "put",
			storeName: "sessionTactics",
			value: { conversationId: id, tacticIds: importedConversation.tacticIds },
		});
		operations.push({
			type: "put",
			storeName: "sessionStates",
			value: { conversationId: id, states: importedConversation.userState },
		});
		for (const run of importedConversation.tacticRuns)
			operations.push({ type: "put", storeName: "tacticRuns", value: run });
		imported++;
	}
	await runLocalTransaction(operations);
	return {
		conversations: data.conversations.length,
		tactics: data.tactics.length,
		stateDefinitions: data.stateDefinitions.length,
		imported,
		skipped,
		replaced,
		preserved,
		strategy,
	};
}

function validateImportedConfig(value: unknown): VioloopConfig | undefined {
	if (!value || typeof value !== "object") return undefined;
	const result = z
		.object({
			chat: z.object({
				defaultProvider: z.string(),
				defaultModel: z.string(),
				systemPrompt: z.string(),
				compaction: z.object({
					enabled: z.boolean(),
					triggerTokens: z.number().positive(),
					keepRecentTokens: z.number().positive(),
				}),
			}),
			providers: z.record(
				z.string(),
				z.object({ baseUrl: z.string(), api: z.literal("openai-completions") }),
			),
		})
		.safeParse(value);
	if (!result.success)
		throw new Error("Import contains an invalid configuration.");
	return value as VioloopConfig;
}
function mergeConfig(
	current: VioloopConfig | undefined,
	imported: VioloopConfig,
) {
	return {
		...imported,
		providers: Object.fromEntries(
			Object.entries(imported.providers).map(([id, provider]) => [
				id,
				{
					...provider,
					...(current?.providers[id]?.apiKey
						? { apiKey: current.providers[id].apiKey }
						: {}),
				},
			]),
		),
	};
}

function mergeConfigPreservingCurrent(
	current: VioloopConfig,
	imported: VioloopConfig,
) {
	const providers = { ...current.providers };
	for (const [id, provider] of Object.entries(imported.providers)) {
		if (!providers[id]) providers[id] = provider;
	}
	return { ...current, providers };
}

function validateCrossReferences(
	data: VioloopExport,
	currentStates: Awaited<ReturnType<typeof listStateDefinitionsLocal>>,
) {
	const stateIds = new Set([
		...currentStates.map((state) => state.id),
		...data.stateDefinitions.map((state) => state.id),
	]);
	for (const tactic of data.tactics) {
		const missing = tactic.emotionRules
			.map((rule) => rule.key)
			.filter((key) => !stateIds.has(key));
		if (missing.length > 0) {
			throw new Error(
				`Tactic "${tactic.id}" requires unknown states: ${[...new Set(missing)].join(", ")}.`,
			);
		}
	}
	for (const entry of data.conversations) {
		const conversationId = entry.conversation.id;
		if (entry.clock && entry.clock.conversationId !== conversationId)
			throw new Error(`Conversation "${conversationId}" has an invalid clock.`);
		if (
			entry.timelineItems.some((item) => item.conversationId !== conversationId)
		)
			throw new Error(
				`Conversation "${conversationId}" has an invalid timeline item.`,
			);
		if (
			entry.compactions.some((item) => item.conversationId !== conversationId)
		)
			throw new Error(
				`Conversation "${conversationId}" has an invalid compaction.`,
			);
		if (
			entry.tacticRuns.some(
				(run) => run.conversationId && run.conversationId !== conversationId,
			)
		)
			throw new Error(
				`Conversation "${conversationId}" has an invalid tactic run.`,
			);
	}
}
