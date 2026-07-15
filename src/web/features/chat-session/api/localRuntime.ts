import { assemblePrompt } from "../../../../shared/domain/prompt";
import {
	applyStatePatchValues,
	estimateContextTokens,
	formatCompactionPrompt,
	sanitizeRuntimeText,
	splitMessagesForCompaction,
	toPromptTimeline,
} from "../../../../shared/domain/runtime";
import { scoreTactic as scoreSharedTactic } from "../../../../shared/domain/tactics";
import type {
	ChatMessage,
	ChatUsage,
	ConversationSummary,
	LoadedTactic,
	PromptBlock,
	SessionClock,
	StoredCompaction,
	TacticRunLogEntry,
	TimelineItem,
	UserState,
	VioloopConfig,
} from "../../../../shared/types";
import { createClientId } from "../../../shared/lib";
import {
	getSessionTacticIdsLocal,
	getSessionUserStateLocal,
	listTacticRunsLocal,
	listTacticsLocal,
	saveSessionClockLocal,
	saveSessionUserStateLocal,
	saveTacticRunLocal,
} from "../../../shared/storage/repository";

const dailyStateJobs = new Set<string>();

export type TacticDecision = {
	tacticId: string;
	name: string;
	score: number;
	loaded: boolean;
	decision: "loaded" | "skipped";
	reasons: string[];
	matchedKeywords: string[];
	contraindications: string[];
};

export type LocalTacticSelection = {
	loaded: LoadedTactic[];
	decisions: TacticDecision[];
	states: UserState[];
};

export const assembleLocalChatPrompt = assemblePrompt;

export async function selectLocalTactics(input: {
	conversationId: string;
	message: string;
	messageId?: string | null;
	persist?: boolean;
}): Promise<LocalTacticSelection & { runs: TacticRunLogEntry[] }> {
	const ids = await getSessionTacticIdsLocal(input.conversationId);
	const states = (await getSessionUserStateLocal(input.conversationId)) ?? [];
	const tactics = (await listTacticsLocal())
		.filter((tactic) => ids.includes(tactic.id))
		.sort((a, b) => a.name.localeCompare(b.name));
	const decisions = tactics.map((tactic) =>
		scoreSharedTactic(tactic, input.message, states),
	);
	const winners = limitTactics(decisions);
	const winnerIds = new Set(winners.map((decision) => decision.tacticId));
	const runs: TacticRunLogEntry[] = [];
	for (const decision of decisions) {
		if (decision.loaded && !winnerIds.has(decision.tacticId)) {
			decision.loaded = false;
			decision.decision = "skipped";
			decision.reasons.push(
				"randomly skipped because more than 5 tactics matched",
			);
		}
		const run: TacticRunLogEntry = {
			id: createClientId("tactic-run"),
			conversationId: input.conversationId,
			messageId: input.messageId ?? null,
			tacticId: decision.tacticId,
			score: decision.score,
			loaded: decision.loaded,
			decision: decision.decision,
			reason: {
				reasons: decision.reasons,
				matchedKeywords: decision.matchedKeywords,
				contraindications: decision.contraindications,
			},
			createdAt: new Date().toISOString(),
		};
		runs.push(run);
		if (input.persist !== false) await saveTacticRunLocal(run);
	}
	const tacticById = new Map(tactics.map((tactic) => [tactic.id, tactic]));
	const loaded = decisions
		.filter((decision) => decision.loaded)
		.map((decision) => ({
			...(tacticById.get(decision.tacticId) as (typeof tactics)[number]),
			score: decision.score,
		}));
	return { loaded, decisions, states, runs };
}

export async function listLocalTacticRuns(conversationId: string) {
	return listTacticRunsLocal(conversationId);
}

export async function generateOpeningScenesLocal(input: {
	conversation: ConversationSummary;
	config: VioloopConfig;
}) {
	const provider = resolveProvider(input.config);
	const response = await callWorker({
		provider,
		promptBlocks: [
			{
				label: "stable-system",
				cacheScope: "stable",
				content: [
					"Generate opening scene messages for a new Violoop chat session.",
					'Return JSON only with shape {"scenes":["..."]}.',
					"Write 1 or 2 short scene messages.",
					"The scene is neutral narration, not assistant speech.",
					"Do not include dialogue, markdown, labels, or UI mechanics.",
				].join(" "),
			},
		],
		messages: [
			{
				role: "user",
				content: JSON.stringify({
					scenePurpose:
						"Opening narration shown before the first user message.",
					assistantDisplayName: input.conversation.profile.assistantName,
					userRole: input.conversation.profile.userRole,
					assistantRole: input.conversation.profile.assistantRole,
					day: 1,
				}),
			},
		],
		temperature: input.config.chat.temperature,
		thinkingLevel: input.config.chat.thinkingLevel,
		cache: input.config.chat.cache,
	});
	const parsed = parseJsonObject(response.text);
	return Array.isArray(parsed.scenes)
		? parsed.scenes
				.map((scene) => sanitize(scene, 500))
				.filter(Boolean)
				.slice(0, 2)
		: [];
}

export async function compactLocalConversation(input: {
	conversation: ConversationSummary;
	config: VioloopConfig;
	timeline: TimelineItem[];
	summary?: StoredCompaction;
}) {
	if (!input.config.chat.compaction.enabled) return undefined;
	const visible = toPromptTimeline(
		input.timeline.filter((item) => item.promptVisibility !== "hidden"),
		input.summary,
	);
	if (
		estimateContextTokens(input.summary, visible) <
		input.config.chat.compaction.triggerTokens
	)
		return undefined;
	const keep = splitMessagesForCompaction(
		visible,
		input.config.chat.compaction.keepRecentTokens,
	);
	if (keep.compact.length === 0) return undefined;
	const provider = resolveProvider(input.config);
	const response = await callWorker({
		provider,
		promptBlocks: [
			{
				label: "stable-system",
				cacheScope: "stable",
				content: [
					"You compact chat history for a chatbot session.",
					"Preserve durable facts, user goals, decisions, constraints, unresolved tasks, and important assistant actions.",
					"Do not add new facts. Prefer dense, concise topic bullets.",
				].join(" "),
			},
		],
		messages: [
			{
				role: "user",
				content: formatCompactionPrompt(input.summary?.summary, keep.compact),
			},
		],
		temperature: input.config.chat.temperature,
		thinkingLevel: input.config.chat.thinkingLevel,
		cache: input.config.chat.cache,
	});
	const summary = sanitize(response.text, 12000);
	if (!summary) return undefined;
	return {
		id: createClientId("compaction"),
		conversationId: input.conversation.id,
		summary,
		firstKeptMessageId: keep.keep[0]?.id,
		coveredMessageIds: keep.compact.map((item) => item.id),
		tokenEstimate: estimateContextTokens(input.summary, visible),
		createdAt: new Date().toISOString(),
		model: provider.model.id,
	} satisfies StoredCompaction;
}

export async function runDailyStateUpdateLocal(input: {
	conversation: ConversationSummary;
	config: VioloopConfig;
	clock: SessionClock;
	timeline: TimelineItem[];
	states?: UserState[];
	persist?: boolean;
}) {
	if (
		!input.conversation.capabilities.sessionState ||
		input.clock.stateUpdatedDay === input.clock.day
	)
		return { applied: [], note: "", states: undefined, clock: input.clock };
	const jobKey = `${input.conversation.id}:${input.clock.day}`;
	if (dailyStateJobs.has(jobKey)) {
		return { applied: [], note: "", states: undefined, clock: input.clock };
	}
	dailyStateJobs.add(jobKey);
	try {
		const states =
			input.states ??
			(await getSessionUserStateLocal(input.conversation.id)) ??
			[];
		const provider = resolveProvider(input.config);
		const response = await callWorker({
			provider,
			promptBlocks: [
				{
					label: "stable-system",
					cacheScope: "stable",
					content:
						"Update bounded Violoop session state after a day transition. Return JSON only. Each delta must be between -10 and 10. Do not advance the day.",
				},
				{
					label: "dynamic-runtime",
					content: `Allowed keys: ${states.map((state) => state.key).join(", ") || "none"}.`,
				},
			],
			messages: [
				{
					role: "user",
					content: JSON.stringify({
						day: input.clock.day,
						states,
						recentTimeline: input.timeline.slice(-12).map((item) => ({
							kind: item.kind,
							role: item.role,
							content: item.content,
						})),
					}),
				},
			],
			temperature: input.config.chat.temperature,
			thinkingLevel: input.config.chat.thinkingLevel,
			cache: input.config.chat.cache,
		});
		const parsed = parseJsonObject(response.text);
		const applied = applyStatePatchValues(states, parsed.patches);
		const nextClock = {
			...input.clock,
			stateUpdatedDay: input.clock.day,
			updatedAt: new Date().toISOString(),
		};
		if (input.persist !== false) {
			await saveSessionUserStateLocal(input.conversation.id, states);
			await saveSessionClockLocal(nextClock);
		}
		return {
			applied,
			note: sanitize(parsed.stateNote, 800),
			states,
			clock: nextClock,
		};
	} finally {
		dailyStateJobs.delete(jobKey);
	}
}

export async function callWorker(input: {
	provider: ReturnType<typeof resolveProvider>;
	messages: ChatMessage[];
	promptBlocks: PromptBlock[];
	temperature?: number;
	thinkingLevel?: VioloopConfig["chat"]["thinkingLevel"];
	cache?: VioloopConfig["chat"]["cache"];
}) {
	const response = await fetch("/api/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok) {
		const payload = (await response.json().catch(() => null)) as {
			error?: string;
			detail?: string;
		} | null;
		throw new Error(
			payload?.detail ??
				payload?.error ??
				`Request failed with ${response.status}`,
		);
	}
	return (await response.json()) as { text: string; usage?: ChatUsage };
}

export function resolveProvider(config: VioloopConfig) {
	const id = config.chat.defaultProvider;
	const provider = config.providers[id];
	if (!provider) throw new Error(`Provider "${id}" is not configured.`);
	const model = provider.models?.find(
		(item) => item.id === config.chat.defaultModel,
	) ?? { id: config.chat.defaultModel };
	return {
		...provider,
		id,
		name: provider.name ?? id,
		model,
		baseUrl: provider.baseUrl.replace(/\/+$/, ""),
		authHeader: provider.authHeader ?? true,
		headers: provider.headers ?? {},
		compat: { ...provider.compat, ...model.compat },
	};
}

export const applyStatePatches = applyStatePatchValues;

function limitTactics(decisions: TacticDecision[]) {
	const loaded = decisions.filter((decision) => decision.loaded);
	if (loaded.length <= 5) return loaded;
	const shuffled = [...loaded];
	for (let index = shuffled.length - 1; index > 0; index -= 1) {
		const target = Math.floor(Math.random() * (index + 1));
		[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
	}
	return shuffled.slice(0, 5);
}

function parseJsonObject(content: string): Record<string, unknown> {
	const start = content.indexOf("{");
	const end = content.lastIndexOf("}");
	if (start < 0 || end <= start) return {};
	try {
		return JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
	} catch {
		return {};
	}
}
function sanitize(value: unknown, maxLength = 4000) {
	return sanitizeRuntimeText(value, maxLength).replace(/\s+/g, " ");
}
