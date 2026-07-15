import {
	stateDefinitionSchema,
	tacticSchema,
} from "../../../shared/domain/runtime";
import type {
	ConfigResponse,
	ConversationPayload,
	ProviderConfig,
	StateDefinition,
	Tactic,
	TacticOverview,
	TacticsMutationResponse,
	TacticsStatusResponse,
	UserState,
	VioloopConfig,
} from "../../../shared/types";
import { getLocal, listLocal, putLocal } from "./database";
import {
	deleteConversationLocal,
	deleteStateDefinitionLocal,
	deleteTacticLocal,
	getConfig,
	getConversationLocal,
	getSessionClockLocal,
	getSessionTacticIdsLocal,
	getSessionUserStateLocal,
	listConversationsLocal,
	listStateDefinitionsLocal,
	listTacticRunsLocal,
	listTacticsLocal,
	listTimelineItemsLocal,
	saveConfig,
	saveConversationLocal,
	saveSessionTacticIdsLocal,
	saveStateDefinitionLocal,
	saveTacticLocal,
} from "./repository";

export function hasIndexedDb() {
	return typeof indexedDB !== "undefined";
}

export async function ensureLocalSeed() {
	if (!hasIndexedDb()) return;
	const seedMeta = await getLocal<{ id: string; complete?: boolean }>(
		"meta",
		"seed",
	);
	if (seedMeta?.id === "seed" && seedMeta.complete === true) return;

	const [configResponse, tacticsResponse, statesResponse] = await Promise.all([
		fetch("/default-data/settings.json"),
		fetch("/default-data/tactics.json"),
		fetch("/default-data/states.json"),
	]);
	if (!configResponse.ok || !tacticsResponse.ok || !statesResponse.ok) {
		throw new Error("Unable to initialize local Violoop data.");
	}
	const config = (await configResponse.json()) as VioloopConfig;
	const tactics = (await tacticsResponse.json()) as Tactic[];
	const states = (await statesResponse.json()) as StateDefinition[];

	if (!(await getConfig())) await saveConfig(config);
	const existingTacticIds = new Set(
		(await listTacticsLocal()).map((tactic) => tactic.id),
	);
	for (const tactic of tactics) {
		if (!existingTacticIds.has(tactic.id)) await saveTacticLocal(tactic);
	}
	const existingStateIds = new Set(
		(await listStateDefinitionsLocal()).map((state) => state.id),
	);
	for (const state of states) {
		if (!existingStateIds.has(state.id)) await saveStateDefinitionLocal(state);
	}

	await putLocal("meta", {
		id: "seed",
		complete: true,
		seededAt: new Date().toISOString(),
	});
}

export async function getLocalConfigResponse(): Promise<ConfigResponse> {
	await ensureLocalSeed();
	const config = await getConfig();
	if (!config) throw new Error("Local configuration is unavailable.");
	const provider = config.providers[config.chat.defaultProvider];
	const model = provider?.models?.find(
		(item) => item.id === config.chat.defaultModel,
	);
	return {
		config,
		provider: config.chat.defaultProvider,
		providerName: provider?.name || config.chat.defaultProvider,
		baseUrl: provider?.baseUrl || "",
		api: provider?.api || "openai-completions",
		model: config.chat.defaultModel,
		cache: {
			systemPrompt: config.chat.cache?.systemPrompt ?? false,
			cacheControlFormat: (model?.compat ?? provider?.compat)
				?.cacheControlFormat,
			usageInStreaming:
				(model?.compat ?? provider?.compat)?.supportsUsageInStreaming !== false,
		},
	};
}

export async function saveLocalConfig(config: VioloopConfig) {
	await ensureLocalSeed();
	await saveConfig(config);
	return { config };
}

export async function listLocalConversations() {
	await ensureLocalSeed();
	return listConversationsLocal();
}

export async function getLocalConversationPayload(
	id: string,
): Promise<ConversationPayload> {
	const conversation = await getConversationLocal(id);
	if (!conversation) throw new Error(`Conversation "${id}" was not found.`);
	return {
		conversation,
		clock: conversation.capabilities.dayProgression
			? ((await getSessionClockLocal(id)) ?? null)
			: null,
		timelineItems: await listTimelineItemsLocal(id),
	};
}

export async function renameLocalConversation(id: string, title: string) {
	const conversation = await getConversationLocal(id);
	if (!conversation) throw new Error(`Conversation "${id}" was not found.`);
	const renamed = {
		...conversation,
		title: normalizeTitle(title),
		updatedAt: new Date().toISOString(),
	};
	await saveConversationLocal(renamed);
	return listLocalConversations();
}

export async function removeLocalConversation(id: string) {
	if (!(await getConversationLocal(id)))
		throw new Error(`Conversation "${id}" was not found.`);
	await deleteConversationLocal(id);
	return listLocalConversations();
}

export async function getLocalTacticsStatus(
	conversationId?: string | null,
): Promise<TacticsStatusResponse> {
	await ensureLocalSeed();
	const [tactics, stateDefinitions] = await Promise.all([
		listTacticsLocal(),
		listStateDefinitionsLocal(),
	]);
	const allowed = conversationId
		? await getSessionTacticIdsLocal(conversationId)
		: tactics.map((tactic) => tactic.id);
	const userState = conversationId
		? ((await getSessionUserStateLocal(conversationId)) ?? [])
		: await defaultStates();
	return {
		conversationId: conversationId ?? undefined,
		tactics: tactics
			.map((tactic) => ({
				...tactic,
				allowedInSession: allowed.includes(tactic.id),
				requiredStateIds: requiredStateIds(tactic),
			}))
			.sort((a, b) => a.name.localeCompare(b.name)),
		stateDefinitions,
		userState,
		clock: conversationId
			? ((await getSessionClockLocal(conversationId)) ?? null)
			: null,
		recentRuns: conversationId
			? (await listTacticRunsLocal(conversationId)).slice(0, 10)
			: [],
	};
}

export async function saveLocalTactic(
	tactic: Tactic,
	originalId: string | null,
): Promise<TacticsMutationResponse> {
	await ensureLocalSeed();
	const normalized = await validateAndNormalizeTactic(tactic);
	if (originalId && originalId !== normalized.id)
		throw new Error("A tactic update cannot change its id.");
	if (
		!originalId &&
		(await listTacticsLocal()).some((item) => item.id === normalized.id)
	)
		throw new Error(`Tactic "${normalized.id}" already exists.`);
	await saveTacticLocal(normalized);
	return localMutationResponse();
}

export async function removeLocalTactic(id: string) {
	if (!(await listTacticsLocal()).some((tactic) => tactic.id === id))
		throw new Error(`Tactic "${id}" was not found.`);
	await deleteTacticLocal(id);
	const sessions = await listLocal<{
		conversationId: string;
		tacticIds: string[];
	}>("sessionTactics");
	for (const session of sessions) {
		if (!session.tacticIds.includes(id)) continue;
		await saveSessionTacticIdsLocal(
			session.conversationId,
			session.tacticIds.filter((tacticId) => tacticId !== id),
		);
	}
	return localMutationResponse();
}

export async function saveLocalState(
	state: StateDefinition,
	originalId: string | null,
) {
	await ensureLocalSeed();
	const normalized = stateDefinitionSchema.parse({
		...state,
		id: state.id.trim(),
		name: state.name.trim(),
		description: state.description?.trim(),
	});
	if (originalId && originalId !== normalized.id)
		throw new Error("A state update cannot change its id.");
	if (
		!originalId &&
		(await listStateDefinitionsLocal()).some(
			(item) => item.id === normalized.id,
		)
	)
		throw new Error(`State "${normalized.id}" already exists.`);
	await saveStateDefinitionLocal(normalized);
	return localMutationResponse();
}

export async function removeLocalState(id: string) {
	const tactics = await listTacticsLocal();
	const dependents = tactics.filter((tactic) =>
		requiredStateIds(tactic).includes(id),
	);
	if (dependents.length)
		throw new Error(
			`State "${id}" is used by tactics: ${dependents.map((tactic) => tactic.name).join(", ")}.`,
		);
	if (!(await listStateDefinitionsLocal()).some((state) => state.id === id))
		throw new Error(`State "${id}" was not found.`);
	await deleteStateDefinitionLocal(id);
	return localMutationResponse();
}

async function localMutationResponse(): Promise<TacticsMutationResponse> {
	const status = await getLocalTacticsStatus();
	return { tactics: status.tactics, stateDefinitions: status.stateDefinitions };
}

async function validateAndNormalizeTactic(tactic: Tactic): Promise<Tactic> {
	const normalized = tacticSchema.parse({
		...tactic,
		id: tactic.id.trim(),
		name: tactic.name.trim(),
		keywords: tactic.keywords.map((item) => item.trim()).filter(Boolean),
		blockedKeywords: tactic.blockedKeywords
			.map((item) => item.trim())
			.filter(Boolean),
		instruction: tactic.instruction.trim(),
	});
	const stateIds = new Set(
		(await listStateDefinitionsLocal()).map((state) => state.id),
	);
	const missing = requiredStateIds(normalized).filter(
		(id) => !stateIds.has(id),
	);
	if (missing.length)
		throw new Error(`Tactic requires unknown states: ${missing.join(", ")}.`);
	return normalized;
}

export async function defaultStates(
	enabledStateIds?: string[],
): Promise<UserState[]> {
	const now = new Date().toISOString();
	const enabled = enabledStateIds ? new Set(enabledStateIds) : undefined;
	return (await listStateDefinitionsLocal())
		.filter((state) => !enabled || enabled.has(state.id))
		.map((state) => ({
			key: state.id,
			value: state.defaultValue,
			source: "inferred" as const,
			confidence: 0.2,
			updatedAt: now,
		}));
}

export function normalizeTitle(title?: string | null) {
	return normalizeText(title, "New chat", 80);
}
function normalizeText(
	value: string | undefined | null,
	fallback: string,
	max: number,
) {
	const normalized = String(value == null ? "" : value)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, max);
	return normalized.length > 0 ? normalized : fallback;
}
export function requiredStateIds(tactic: Pick<Tactic, "emotionRules">) {
	return [...new Set(tactic.emotionRules.map((rule) => rule.key))].sort();
}

export type { ProviderConfig, TacticOverview };
