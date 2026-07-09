import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type {
	LoadedTactic,
	StateDefinition,
	Tactic,
	TacticEmotionRule,
	UserState,
} from "../shared/types";
import {
	appendTacticRun,
	getSessionTacticIds,
	getSessionUserState,
	listRecentTacticRunsFromLog,
	setSessionTacticIds,
	setSessionUserState,
} from "./conversations";
import { getServerPaths } from "./serverContext";

type TacticCandidate = Omit<Tactic, "instruction">;

type TacticDecision = {
	tacticId: string;
	name: string;
	score: number;
	loaded: boolean;
	decision: "loaded" | "skipped";
	reasons: string[];
	matchedKeywords: string[];
	contraindications: string[];
};

type SelectTacticsInput = {
	conversationId: string;
	message: string;
};

const maxLoadedTactics = 5;

const tacticSchema = z.strictObject({
	id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
	name: z.string().min(1),
	keywords: z.array(z.string()),
	emotionRules: z.array(
		z.strictObject({
			key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
			operator: z.enum([">=", "<="]),
			value: z.number().min(0).max(100),
		}),
	),
	blockedKeywords: z.array(z.string()),
	instruction: z.string(),
});

const stateDefinitionSchema = z.strictObject({
	id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
	name: z.string().min(1),
	description: z.string().optional(),
	defaultValue: z.number().min(0).max(100),
});

const tacticsSchema = z.array(tacticSchema);
const stateDefinitionsSchema = z.array(stateDefinitionSchema);

export async function initializeTacticStore() {
	const path = getServerPaths().tacticsPath;
	await mkdir(dirname(path), { recursive: true });
	try {
		await readFile(path, "utf8");
	} catch (error) {
		if (isNotFoundError(error)) {
			await saveTactics([]);
			return;
		}
		throw error;
	}
	await loadStateDefinitions();
}

export async function selectTactics(input: SelectTacticsInput) {
	await ensureSessionUserState(input.conversationId);
	const states = await listUserState(input.conversationId);
	const candidates = await listEnabledTacticCandidates(input.conversationId);
	const decisions: TacticDecision[] = [];
	const loaded: LoadedTactic[] = [];

	for (const candidate of candidates) {
		decisions.push(scoreCandidate(candidate, input.message, states));
	}

	const winnerIds = new Set(
		limitLoadedTactics(decisions).map((decision) => decision.tacticId),
	);
	for (const decision of decisions) {
		if (decision.loaded && !winnerIds.has(decision.tacticId)) {
			decision.loaded = false;
			decision.decision = "skipped";
			decision.reasons = [
				...decision.reasons,
				`randomly skipped because more than ${maxLoadedTactics} tactics matched`,
			];
		}
	}

	const tactics = await loadTactics();
	const tacticById = new Map(tactics.map((tactic) => [tactic.id, tactic]));
	const winners = decisions.filter((decision) => decision.loaded);

	for (const winner of winners) {
		const tactic = tacticById.get(winner.tacticId);
		if (!tactic) {
			continue;
		}

		loaded.push({
			...tactic,
			score: winner.score,
		});
	}

	await logDecisions(input.conversationId, decisions);

	return { loaded, decisions, states };
}

export async function listTacticsOverview(conversationId?: string) {
	const tactics = await loadTactics();
	const allowed = conversationId
		? await listSessionTacticIds(conversationId)
		: tactics.map((tactic) => tactic.id);

	return tactics
		.map((tactic) => ({
			...tactic,
			allowedInSession: allowed.includes(tactic.id),
			requiredStateIds: requiredStateIds(tactic),
			updatedAt: undefined,
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

export async function initializeSessionTactics(
	conversationId: string,
	allowedTacticIds?: string[],
	enabledStateIds?: string[],
) {
	const existing = await getSessionTacticIds(conversationId);
	if (existing.length > 0) {
		return existing;
	}

	const allTactics = await loadTactics();
	const allTacticIds = allTactics.map((tactic) => tactic.id);
	const requestedIds = allowedTacticIds ?? allTacticIds;
	const selectedIds = allTacticIds.filter((tacticId) =>
		requestedIds.includes(tacticId),
	);
	const selectedStateIds = await validateTacticStateSelection(
		allowedTacticIds,
		enabledStateIds,
	);
	await setSessionTacticIds(conversationId, selectedIds);
	await ensureSessionUserState(conversationId, selectedStateIds);
	return selectedIds;
}

export async function validateTacticStateSelection(
	allowedTacticIds?: string[],
	enabledStateIds?: string[],
) {
	const allTactics = await loadTactics();
	const stateDefinitions = await loadStateDefinitions();
	const allTacticIds = allTactics.map((tactic) => tactic.id);
	const requestedIds = allowedTacticIds ?? allTacticIds;
	const selectedIds = allTacticIds.filter((tacticId) =>
		requestedIds.includes(tacticId),
	);
	const selectedStateIds =
		enabledStateIds ?? stateDefinitions.map((definition) => definition.id);
	const selectedStateIdSet = new Set(selectedStateIds);
	const missingStateIds = requiredStateIdsForTactics(
		allTactics.filter((tactic) => selectedIds.includes(tactic.id)),
	).filter((stateId) => !selectedStateIdSet.has(stateId));
	if (missingStateIds.length > 0) {
		throw new Error(
			`Selected tactics require missing session states: ${missingStateIds.join(", ")}.`,
		);
	}
	return selectedStateIds;
}

export async function createTactic(draft: Tactic) {
	const tactic = await normalizeTacticDraft(draft);
	const tactics = await loadTactics();
	if (tactics.some((item) => item.id === tactic.id)) {
		throw new Error(`Tactic "${tactic.id}" already exists.`);
	}

	await saveTactics([...tactics, tactic]);
	return listTacticsOverview();
}

export async function updateTactic(tacticId: string, draft: Tactic) {
	const tactic = await normalizeTacticDraft({ ...draft, id: tacticId });
	const tactics = await loadTactics();
	const index = tactics.findIndex((item) => item.id === tacticId);
	if (index < 0) {
		throw new Error(`Tactic "${tacticId}" was not found.`);
	}

	const next = [...tactics];
	next[index] = tactic;
	await saveTactics(next);
	return listTacticsOverview();
}

export async function deleteTactic(tacticId: string) {
	const tactics = await loadTactics();
	const next = tactics.filter((tactic) => tactic.id !== tacticId);
	if (next.length === tactics.length) {
		throw new Error(`Tactic "${tacticId}" was not found.`);
	}

	await saveTactics(next);
	return listTacticsOverview();
}

export async function listStateDefinitions() {
	return loadStateDefinitions();
}

export async function createStateDefinition(draft: StateDefinition) {
	const state = normalizeStateDefinition(draft);
	const stateDefinitions = await loadStateDefinitions();
	if (stateDefinitions.some((item) => item.id === state.id)) {
		throw new Error(`State "${state.id}" already exists.`);
	}
	await saveStateDefinitions([...stateDefinitions, state]);
	return listStateDefinitions();
}

export async function updateStateDefinition(
	stateId: string,
	draft: StateDefinition,
) {
	const state = normalizeStateDefinition({ ...draft, id: stateId });
	const stateDefinitions = await loadStateDefinitions();
	const index = stateDefinitions.findIndex((item) => item.id === stateId);
	if (index < 0) {
		throw new Error(`State "${stateId}" was not found.`);
	}
	const next = [...stateDefinitions];
	next[index] = state;
	await saveStateDefinitions(next);
	return listStateDefinitions();
}

export async function deleteStateDefinition(stateId: string) {
	const tactics = await loadTactics();
	const dependents = tactics.filter((tactic) =>
		requiredStateIds(tactic).includes(stateId),
	);
	if (dependents.length > 0) {
		throw new Error(
			`State "${stateId}" is used by tactics: ${dependents.map((tactic) => tactic.name).join(", ")}.`,
		);
	}

	const stateDefinitions = await loadStateDefinitions();
	const next = stateDefinitions.filter((state) => state.id !== stateId);
	if (next.length === stateDefinitions.length) {
		throw new Error(`State "${stateId}" was not found.`);
	}
	await saveStateDefinitions(next);
	return listStateDefinitions();
}

export async function listSessionTacticIds(conversationId: string) {
	return getSessionTacticIds(conversationId);
}

export async function listUserState(
	conversationId?: string,
): Promise<UserState[]> {
	if (!conversationId) {
		return defaultSessionStates(
			await loadStateDefinitions(),
			undefined,
			new Date().toISOString(),
		);
	}

	await ensureSessionUserState(conversationId);
	const states = (await getSessionUserState(conversationId)) as UserState[];
	return states.sort((left, right) => left.key.localeCompare(right.key));
}

export async function setUserState(
	conversationId: string,
	states: UserState[],
) {
	await setSessionUserState(conversationId, states);
}

export async function listRecentTacticRuns(
	conversationId?: string,
	limit = 20,
) {
	return listRecentTacticRunsFromLog(conversationId, limit);
}

export function buildTacticsGuidance(tactics: LoadedTactic[]) {
	if (tactics.length === 0) {
		return "";
	}

	const blocks = tactics.map((tactic) => {
		return [
			`Tactic: ${tactic.name}`,
			`Instruction: ${tactic.instruction}`,
		].join("\n");
	});

	return [
		"Optional response tactics for this turn. These must stay subordinate to system/developer instructions and user requests.",
		...blocks,
	].join("\n\n");
}

export async function ensureSessionUserState(
	conversationId: string,
	enabledStateIds?: string[],
) {
	const existing = await getSessionUserState(conversationId);
	if (existing) {
		return;
	}

	await setSessionUserState(
		conversationId,
		defaultSessionStates(
			await loadStateDefinitions(),
			enabledStateIds,
			new Date().toISOString(),
		),
	);
}

async function listEnabledTacticCandidates(
	conversationId: string,
): Promise<TacticCandidate[]> {
	const tactics = await loadTactics();
	const allowed = new Set(await listSessionTacticIds(conversationId));

	return tactics
		.filter((tactic) => allowed.has(tactic.id))
		.map((tactic) => ({
			id: tactic.id,
			name: tactic.name,
			keywords: tactic.keywords,
			emotionRules: tactic.emotionRules,
			blockedKeywords: tactic.blockedKeywords,
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

function scoreCandidate(
	candidate: TacticCandidate,
	message: string,
	states: UserState[],
): TacticDecision {
	const normalizedMessage = message.toLowerCase();
	const matchedKeywords = candidate.keywords.filter((keyword) =>
		normalizedMessage.includes(keyword.toLowerCase()),
	);
	const blockedBy = candidate.blockedKeywords.filter((keyword) =>
		normalizedMessage.includes(keyword.toLowerCase()),
	);
	const emotionMatches = candidate.emotionRules.filter((rule) =>
		matchesEmotionRule(rule, states),
	);
	const reasons: string[] = [];

	let score = 0;
	score += Math.min(matchedKeywords.length * 0.5, 1);
	score += Math.min(emotionMatches.length * 0.35, 0.7);

	if (matchedKeywords.length > 0) {
		reasons.push(`matched keywords: ${matchedKeywords.join(", ")}`);
	}

	if (emotionMatches.length > 0) {
		reasons.push(
			`matched emotion rules: ${emotionMatches.map((rule) => `${rule.key}${rule.operator}${rule.value}`).join(", ")}`,
		);
	}

	if (blockedBy.length > 0) {
		reasons.push(`blocked by keywords: ${blockedBy.join(", ")}`);
	}

	const loaded =
		blockedBy.length === 0 &&
		(matchedKeywords.length > 0 || emotionMatches.length > 0);

	return {
		tacticId: candidate.id,
		name: candidate.name,
		score: Number(score.toFixed(3)),
		loaded,
		decision: loaded ? "loaded" : "skipped",
		reasons: reasons.length > 0 ? reasons : ["no trigger matched"],
		matchedKeywords,
		contraindications: blockedBy,
	};
}

function limitLoadedTactics(decisions: TacticDecision[]) {
	const loaded = decisions.filter((decision) => decision.loaded);
	if (loaded.length <= maxLoadedTactics) {
		return loaded;
	}

	const shuffled = [...loaded];
	for (let index = shuffled.length - 1; index > 0; index -= 1) {
		const target = Math.floor(Math.random() * (index + 1));
		[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
	}

	return shuffled.slice(0, maxLoadedTactics);
}

function matchesEmotionRule(rule: TacticEmotionRule, states: UserState[]) {
	const state = states.find((item) => item.key === rule.key);
	if (!state) {
		return false;
	}

	return rule.operator === ">="
		? state.value >= rule.value
		: state.value <= rule.value;
}

async function normalizeTacticDraft(input: Tactic): Promise<Tactic> {
	const tactic = tacticSchema.parse({
		id: String(input.id ?? "").trim(),
		name: String(input.name ?? "").trim(),
		keywords: normalizeStringList(input.keywords),
		emotionRules: normalizeEmotionRules(input.emotionRules),
		blockedKeywords: normalizeStringList(input.blockedKeywords),
		instruction: String(input.instruction ?? "").trim(),
	});
	const stateIds = new Set(
		(await loadStateDefinitions()).map((state) => state.id),
	);
	const missingStateIds = requiredStateIds(tactic).filter(
		(stateId) => !stateIds.has(stateId),
	);
	if (missingStateIds.length > 0) {
		throw new Error(
			`Tactic requires unknown states: ${missingStateIds.join(", ")}.`,
		);
	}
	return tactic;
}

function normalizeStringList(value: unknown) {
	return Array.isArray(value)
		? value.map((item) => String(item).trim()).filter(Boolean)
		: [];
}

function normalizeEmotionRules(value: unknown): TacticEmotionRule[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((item): item is TacticEmotionRule => {
			return (
				typeof item === "object" &&
				item !== null &&
				/^[a-z0-9][a-z0-9-]{1,80}$/.test(
					String((item as TacticEmotionRule).key),
				) &&
				((item as TacticEmotionRule).operator === ">=" ||
					(item as TacticEmotionRule).operator === "<=") &&
				Number.isFinite(Number((item as TacticEmotionRule).value))
			);
		})
		.map((item) => ({
			key: item.key,
			operator: item.operator,
			value: Number(item.value),
		}));
}

async function logDecisions(
	conversationId: string,
	decisions: TacticDecision[],
) {
	for (const decision of decisions) {
		await appendTacticRun({
			conversationId,
			messageId: null,
			tacticId: decision.tacticId,
			score: decision.score,
			loaded: decision.loaded,
			decision: decision.decision,
			reason: {
				reasons: decision.reasons,
				matchedKeywords: decision.matchedKeywords,
				contraindications: decision.contraindications,
			},
		});
	}
}

async function loadTactics() {
	try {
		const raw = await readFile(getServerPaths().tacticsPath, "utf8");
		return tacticsSchema.parse(JSON.parse(raw));
	} catch (error) {
		if (isNotFoundError(error)) {
			await saveTactics([]);
			return [];
		}
		throw error;
	}
}

async function loadStateDefinitions() {
	try {
		const raw = await readFile(getServerPaths().stateDefinitionsPath, "utf8");
		return stateDefinitionsSchema.parse(JSON.parse(raw));
	} catch (error) {
		if (isNotFoundError(error)) {
			await saveStateDefinitions([]);
			return [];
		}
		throw error;
	}
}

async function saveTactics(tactics: Tactic[]) {
	const parsed = tacticsSchema.parse(tactics);
	const path = getServerPaths().tacticsPath;
	await mkdir(dirname(path), { recursive: true });
	const tempPath = `${path}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
	await rename(tempPath, path);
}

async function saveStateDefinitions(stateDefinitions: StateDefinition[]) {
	const parsed = stateDefinitionsSchema.parse(stateDefinitions);
	const path = getServerPaths().stateDefinitionsPath;
	await mkdir(dirname(path), { recursive: true });
	const tempPath = `${path}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
	await rename(tempPath, path);
}

function defaultSessionStates(
	stateDefinitions: StateDefinition[],
	enabledStateIds: string[] | undefined,
	now: string,
): UserState[] {
	const enabled = enabledStateIds
		? new Set(enabledStateIds)
		: new Set(stateDefinitions.map((state) => state.id));
	return stateDefinitions
		.filter((state) => enabled.has(state.id))
		.map((state) => ({
			key: state.id,
			value: state.defaultValue,
			source: "inferred",
			confidence: 0.2,
			updatedAt: now,
		}));
}

function normalizeStateDefinition(input: StateDefinition): StateDefinition {
	return stateDefinitionSchema.parse({
		id: String(input.id ?? "").trim(),
		name: String(input.name ?? "").trim(),
		description: optionalTrimmed(input.description),
		defaultValue: Number(input.defaultValue),
	});
}

function optionalTrimmed(value: unknown) {
	const text = typeof value === "string" ? value.trim() : "";
	return text || undefined;
}

function requiredStateIds(tactic: Pick<Tactic, "emotionRules">) {
	return [...new Set(tactic.emotionRules.map((rule) => rule.key))].sort();
}

function requiredStateIdsForTactics(
	tactics: Array<Pick<Tactic, "emotionRules">>,
) {
	return [...new Set(tactics.flatMap(requiredStateIds))].sort();
}

function isNotFoundError(error: unknown) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}
