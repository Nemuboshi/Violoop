import type {
	ChatUsage,
	ConversationSummary,
	SessionClock,
	StateDefinition,
	StoredCompaction,
	Tactic,
	TacticRunLogEntry,
	TimelineItem,
	UserState,
	VioloopConfig,
} from "../../../shared/types";

import {
	clearLocal,
	deleteLocal,
	getLocal,
	listLocal,
	putLocal,
	runLocalTransaction,
} from "./database";

export type ConversationExport = {
	conversation: ConversationSummary;
	timelineItems: TimelineItem[];
	compactions: StoredCompaction[];
	clock?: SessionClock;
	tacticIds: string[];
	userState: UserState[];
	tacticRuns: TacticRunLogEntry[];
};

export async function getConfig() {
	const stored = await getLocal<{ id: string; config: VioloopConfig }>(
		"config",
		"current",
	);
	return stored?.config;
}

export async function saveConfig(config: VioloopConfig) {
	await putLocal("config", { id: "current", config });
	return config;
}

export async function listConversationsLocal() {
	return (await listLocal<ConversationSummary>("conversations")).sort((a, b) =>
		b.updatedAt.localeCompare(a.updatedAt),
	);
}

export async function getConversationLocal(id: string) {
	return getLocal<ConversationSummary>("conversations", id);
}

export async function saveConversationLocal(conversation: ConversationSummary) {
	await putLocal("conversations", conversation);
}

export async function deleteConversationLocal(id: string) {
	const [items, compactions, runs] = await Promise.all([
		listTimelineItemsLocal(id),
		listCompactionsLocal(id),
		listTacticRunsLocal(id),
	]);
	await runLocalTransaction([
		{ type: "delete", storeName: "conversations", key: id },
		...items.map((item) => ({
			type: "delete" as const,
			storeName: "timelineItems" as const,
			key: item.id,
		})),
		...compactions.map((item) => ({
			type: "delete" as const,
			storeName: "compactions" as const,
			key: item.id,
		})),
		...runs.map((run) => ({
			type: "delete" as const,
			storeName: "tacticRuns" as const,
			key: run.id,
		})),
		...(["sessionClocks", "sessionTactics", "sessionStates"] as const).map(
			(storeName) => ({ type: "delete" as const, storeName, key: id }),
		),
	]);
}

export async function listTimelineItemsLocal(conversationId: string) {
	return (await listLocal<TimelineItem>("timelineItems"))
		.filter((item) => item.conversationId === conversationId)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function saveTimelineItemLocal(item: TimelineItem) {
	await putLocal("timelineItems", item);
}

export async function listCompactionsLocal(conversationId: string) {
	return (await listLocal<StoredCompaction>("compactions"))
		.filter((item) => item.conversationId === conversationId)
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function saveCompactionLocal(compaction: StoredCompaction) {
	await putLocal("compactions", compaction);
}

export async function getSessionClockLocal(conversationId: string) {
	return getLocal<SessionClock>("sessionClocks", conversationId);
}

export async function saveSessionClockLocal(clock: SessionClock) {
	await putLocal("sessionClocks", clock);
}

export async function getSessionTacticIdsLocal(conversationId: string) {
	return (
		(
			await getLocal<{ conversationId: string; tacticIds: string[] }>(
				"sessionTactics",
				conversationId,
			)
		)?.tacticIds ?? []
	);
}

export async function saveSessionTacticIdsLocal(
	conversationId: string,
	tacticIds: string[],
) {
	await putLocal("sessionTactics", { conversationId, tacticIds });
}

export async function getSessionUserStateLocal(conversationId: string) {
	return (
		await getLocal<{ conversationId: string; states: UserState[] }>(
			"sessionStates",
			conversationId,
		)
	)?.states;
}

export async function saveSessionUserStateLocal(
	conversationId: string,
	states: UserState[],
) {
	await putLocal("sessionStates", { conversationId, states });
}

export async function listTacticRunsLocal(conversationId?: string) {
	return (await listLocal<TacticRunLogEntry>("tacticRuns"))
		.filter((run) => !conversationId || run.conversationId === conversationId)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveTacticRunLocal(run: TacticRunLogEntry) {
	await putLocal("tacticRuns", run);
}

export async function listTacticsLocal() {
	return listLocal<Tactic>("tactics");
}

export async function saveTacticLocal(tactic: Tactic) {
	await putLocal("tactics", tactic);
}

export async function deleteTacticLocal(id: string) {
	await deleteLocal("tactics", id);
}

export async function listStateDefinitionsLocal() {
	return listLocal<StateDefinition>("stateDefinitions");
}

export async function saveStateDefinitionLocal(state: StateDefinition) {
	await putLocal("stateDefinitions", state);
}

export async function deleteStateDefinitionLocal(id: string) {
	await deleteLocal("stateDefinitions", id);
}

export async function saveUsageLocal(requestId: string, usage: ChatUsage) {
	await putLocal("usage", { requestId, usage });
}

export async function getUsageLocal(requestId: string) {
	return (
		await getLocal<{ requestId: string; usage: ChatUsage }>("usage", requestId)
	)?.usage;
}

export async function listUsageLocal() {
	return listLocal<{ requestId: string; usage: ChatUsage }>("usage");
}

export async function appendLocalItemsAtomic(
	conversation: ConversationSummary,
	items: TimelineItem[],
	compaction?: StoredCompaction,
	projection: {
		clock?: SessionClock;
		userState?: UserState[];
		requestId?: string;
		usage?: ChatUsage;
		tacticRuns?: TacticRunLogEntry[];
	} = {},
) {
	const current = (await getConversationLocal(conversation.id)) ?? conversation;
	const visibleItems = items.filter(
		(item) => item.promptVisibility !== "hidden",
	).length;
	await runLocalTransaction([
		{
			type: "put",
			storeName: "conversations",
			value: {
				...current,
				messageCount: current.messageCount + visibleItems,
				updatedAt: items.at(-1)?.createdAt ?? current.updatedAt,
			},
		},
		...items.map((item) => ({
			type: "put" as const,
			storeName: "timelineItems" as const,
			value: item,
		})),
		...(compaction
			? [
					{
						type: "put" as const,
						storeName: "compactions" as const,
						value: compaction,
					},
				]
			: []),
		...(projection.clock
			? [
					{
						type: "put" as const,
						storeName: "sessionClocks" as const,
						value: projection.clock,
					},
				]
			: []),
		...(projection.userState
			? [
					{
						type: "put" as const,
						storeName: "sessionStates" as const,
						value: {
							conversationId: conversation.id,
							states: projection.userState,
						},
					},
				]
			: []),
		...(projection.requestId && projection.usage
			? [
					{
						type: "put" as const,
						storeName: "usage" as const,
						value: { requestId: projection.requestId, usage: projection.usage },
					},
				]
			: []),
		...(projection.tacticRuns ?? []).map((run) => ({
			type: "put" as const,
			storeName: "tacticRuns" as const,
			value: run,
		})),
	]);
}

export async function pruneConversationAfterLocal(
	conversation: ConversationSummary,
	retained: TimelineItem[],
	cutoffCreatedAt: string,
	clock?: SessionClock,
) {
	const existingItems = await listTimelineItemsLocal(conversation.id);
	const existingCompactions = await listCompactionsLocal(conversation.id);
	const existingRuns = await listTacticRunsLocal(conversation.id);
	const retainedIds = new Set(retained.map((item) => item.id));
	await runLocalTransaction([
		...existingItems
			.filter((item) => !retainedIds.has(item.id))
			.map((item) => ({
				type: "delete" as const,
				storeName: "timelineItems" as const,
				key: item.id,
			})),
		...existingCompactions.map((item) => ({
			type: "delete" as const,
			storeName: "compactions" as const,
			key: item.id,
		})),
		...existingRuns
			.filter((run) => run.createdAt >= cutoffCreatedAt)
			.map((run) => ({
				type: "delete" as const,
				storeName: "tacticRuns" as const,
				key: run.id,
			})),
		{ type: "put", storeName: "conversations", value: conversation },
		...(clock
			? [
					{
						type: "put" as const,
						storeName: "sessionClocks" as const,
						value: clock,
					},
				]
			: []),
		...retained.map((item) => ({
			type: "put" as const,
			storeName: "timelineItems" as const,
			value: item,
		})),
	]);
}

export async function replaceConversationTimelineLocal(
	conversation: ConversationSummary,
	items: TimelineItem[],
) {
	const existing = await listTimelineItemsLocal(conversation.id);
	await runLocalTransaction([
		...existing.map((item) => ({
			type: "delete" as const,
			storeName: "timelineItems" as const,
			key: item.id,
		})),
		...items.map((item) => ({
			type: "put" as const,
			storeName: "timelineItems" as const,
			value: item,
		})),
		{ type: "put", storeName: "conversations", value: conversation },
	]);
}

export async function clearAllLocalData() {
	for (const store of [
		"config",
		"conversations",
		"timelineItems",
		"compactions",
		"sessionClocks",
		"sessionTactics",
		"sessionStates",
		"tactics",
		"stateDefinitions",
		"tacticRuns",
		"usage",
	] as const) {
		await clearLocal(store);
	}
}
