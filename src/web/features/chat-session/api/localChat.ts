import {
	parseStructuredChatResult,
	sanitizeRuntimeText,
	toPromptTimeline,
} from "../../../../shared/domain/runtime";
import type {
	ChatTurnResult,
	ConversationSummary,
	SessionClock,
	StoredCompaction,
	TimelineItem,
} from "../../../../shared/types";
import { createClientId } from "../../../shared/lib";
import {
	appendLocalItemsAtomic,
	ensureLocalSeed,
	getConfig,
	getConversationLocal,
	getSessionClockLocal,
	getSessionUserStateLocal,
	listCompactionsLocal,
	listTimelineItemsLocal,
	pruneConversationAfterLocal,
} from "../../../shared/storage";
import {
	applyStatePatches,
	assembleLocalChatPrompt,
	callWorker,
	compactLocalConversation,
	resolveProvider,
	runDailyStateUpdateLocal,
	selectLocalTactics,
} from "./localRuntime";

type GenerateTurnOptions =
	| {
			mode: "send";
			pendingUserItem: TimelineItem;
	  }
	| {
			mode: "edit";
			retained: TimelineItem[];
			restoredClock?: SessionClock;
			nextConversation: ConversationSummary;
			afterCreatedAt: string;
	  };

export async function sendLocalChatMessage(input: {
	conversationId: string;
	message: string;
}): Promise<ChatTurnResult> {
	await ensureLocalSeed();
	const conversation = await requireConversation(input.conversationId);
	const userContent = input.message.trim().slice(0, 20000);
	if (!userContent) throw new Error("A user message is required.");
	const userItem = makeItem(conversation, {
		kind: "chat",
		role: "user",
		speakerName: "You",
		content: userContent,
		promptVisibility: "visible",
	});
	return generateTurn(conversation, userContent, userItem.id, {
		mode: "send",
		pendingUserItem: userItem,
	});
}

export async function editLocalLastUserMessage(input: {
	conversationId: string;
	message: string;
}): Promise<ChatTurnResult> {
	await ensureLocalSeed();
	const conversation = await requireConversation(input.conversationId);
	const content = input.message.trim().slice(0, 20000);
	if (!content) throw new Error("A user message is required.");
	const items = await listTimelineItemsLocal(conversation.id);
	const target = [...items]
		.reverse()
		.find((item) => item.kind === "chat" && item.role === "user");
	if (!target) throw new Error("No user message is available to edit.");
	const targetIndex = items.findIndex((item) => item.id === target.id);
	const retained = items
		.slice(0, targetIndex + 1)
		.map((item) => (item.id === target.id ? { ...item, content } : item));
	const nextConversation = {
		...conversation,
		messageCount: retained.filter((item) => item.promptVisibility !== "hidden")
			.length,
		updatedAt: new Date().toISOString(),
	};
	const restoredClock = conversation.capabilities.dayProgression
		? restoreClockFromTimeline(conversation.id, retained)
		: undefined;
	return generateTurn(nextConversation, content, target.id, {
		mode: "edit",
		retained,
		restoredClock,
		nextConversation,
		afterCreatedAt: target.createdAt,
	});
}

async function generateTurn(
	conversation: ConversationSummary,
	userMessage: string,
	messageId: string,
	options: GenerateTurnOptions,
): Promise<ChatTurnResult> {
	const config = await getConfig();
	if (!config) throw new Error("Local configuration is unavailable.");
	const provider = resolveProvider(config);
	const clock =
		options.mode === "edit"
			? (options.restoredClock ?? null)
			: conversation.capabilities.dayProgression
				? ((await getSessionClockLocal(conversation.id)) ?? null)
				: null;
	const tacticSelection = conversation.capabilities.tactics
		? await selectLocalTactics({
				conversationId: conversation.id,
				message: userMessage,
				messageId,
				persist: false,
			})
		: { loaded: [], decisions: [], states: [], runs: [] };
	const baseTimeline =
		options.mode === "edit"
			? options.retained
			: [
					...(await listTimelineItemsLocal(conversation.id)),
					options.pendingUserItem,
				];
	const summaries = await listCompactionsLocal(conversation.id);
	const summary = summaries.at(-1);
	const promptTimeline = toPromptTimeline(baseTimeline, summary);
	const prompt = assembleLocalChatPrompt({
		globalSystemPrompt: config.chat.systemPrompt,
		profile: conversation.profile,
		capabilities: conversation.capabilities,
		clock,
		timeline: promptTimeline,
		summary,
		tactics: tacticSelection.loaded,
	});
	const response = await callWorker({
		provider,
		messages: prompt.messages,
		promptBlocks: prompt.promptBlocks,
		temperature: config.chat.temperature,
		thinkingLevel: config.chat.thinkingLevel,
		cache: config.chat.cache,
	});
	const parsed = parseStructuredChatResult(response.text);
	const assistantItems = (Array.isArray(parsed.messages) ? parsed.messages : [])
		.map((message) => sanitizeMessage(message.content))
		.filter(Boolean)
		.slice(0, 5);
	const messages = assistantItems.length
		? assistantItems
		: ["I could not produce a structured response."];
	const createdItems = messages.map((content, index) =>
		makeItem(conversation, {
			kind: "chat",
			role: "assistant",
			speakerName: conversation.profile.assistantName,
			content,
			promptVisibility: "visible",
			usage: index === messages.length - 1 ? response.usage : undefined,
		}),
	);
	const runtimeResult = await applyRuntimeActions(
		conversation,
		("runtimeActions" in parsed ? parsed.runtimeActions : undefined) as
			| StructuredRuntimeAction[]
			| undefined,
		clock ?? undefined,
	);
	createdItems.push(...runtimeResult.items);

	let compaction: StoredCompaction | undefined;
	try {
		compaction = await compactLocalConversation({
			conversation,
			config,
			timeline: [...baseTimeline, ...createdItems],
			summary,
		});
	} catch (error) {
		console.warn(
			`[compaction] conversation=${conversation.id} skipped:`,
			error instanceof Error ? error.message : error,
		);
	}

	let finalClock = runtimeResult.clock;
	let finalStates = runtimeResult.states;
	if (
		runtimeResult.items.some((item) => item.kind === "day_transition") &&
		conversation.capabilities.sessionState &&
		runtimeResult.clock
	) {
		try {
			const stateResult = await runDailyStateUpdateLocal({
				conversation,
				config,
				clock: runtimeResult.clock,
				states: runtimeResult.states,
				timeline: [...baseTimeline, ...createdItems],
				persist: false,
			});
			if (stateResult.states) {
				const stateItem = makeItem(conversation, {
					kind: "state_update",
					role: "system",
					speakerName: "System",
					content:
						stateResult.note || `Day ${runtimeResult.clock.day} state updated.`,
					promptVisibility: "hidden",
					metadata: {
						day: runtimeResult.clock.day,
						patches: stateResult.applied,
					},
				});
				createdItems.push(stateItem);
				finalClock = stateResult.clock;
				finalStates = stateResult.states;
			}
		} catch (error) {
			console.warn(
				`[daily-state] conversation=${conversation.id} skipped:`,
				error instanceof Error ? error.message : error,
			);
		}
	}

	const requestId = createClientId("request");
	if (options.mode === "edit") {
		await pruneConversationAfterLocal(
			options.nextConversation,
			options.retained,
			options.afterCreatedAt,
			options.restoredClock,
		);
		await appendLocalItemsAtomic(
			options.nextConversation,
			createdItems,
			compaction,
			{
				clock: finalClock ?? undefined,
				userState: finalStates,
				requestId,
				usage: response.usage,
				tacticRuns: tacticSelection.runs,
			},
		);
	} else {
		await appendLocalItemsAtomic(
			conversation,
			[options.pendingUserItem, ...createdItems],
			compaction,
			{
				clock: finalClock ?? undefined,
				userState: finalStates,
				requestId,
				usage: response.usage,
				tacticRuns: tacticSelection.runs,
			},
		);
	}

	return {
		requestId,
		conversationId: conversation.id,
		tacticIds: tacticSelection.loaded.map((tactic) => tactic.id),
		usage: response.usage,
		clock: (await getSessionClockLocal(conversation.id)) ?? null,
		timelineItems: await listTimelineItemsLocal(conversation.id),
		createdItems:
			options.mode === "send"
				? [options.pendingUserItem, ...createdItems]
				: createdItems,
	};
}

async function applyRuntimeActions(
	conversation: ConversationSummary,
	actions: StructuredRuntimeAction[] | undefined,
	clock: Awaited<ReturnType<typeof getSessionClockLocal>>,
) {
	const items: TimelineItem[] = [];
	const states = conversation.capabilities.sessionState
		? await getSessionUserStateLocal(conversation.id)
		: undefined;
	const allowedTools = new Set(
		[
			conversation.capabilities.dayProgression ? "advance_day" : "",
			conversation.capabilities.sceneEvents ? "emit_scene" : "",
			conversation.capabilities.sessionState ? "update_session_state" : "",
		].filter(Boolean),
	);
	const list = (Array.isArray(actions) ? actions : []).filter(
		(action) => !!action.tool && allowedTools.has(action.tool),
	);
	const advance = list.find((action) => action.tool === "advance_day");
	let nextClock = clock;
	if (advance && conversation.capabilities.dayProgression && clock) {
		nextClock = {
			...clock,
			day: clock.day + 1,
			stateUpdatedDay: undefined,
			updatedAt: new Date().toISOString(),
		};
		items.push(
			makeItem(conversation, {
				kind: "day_transition",
				role: "system",
				speakerName: "System",
				content:
					sanitizeRuntimeText(advance.arguments?.content, 800) ||
					`Day ${nextClock.day}`,
				promptVisibility: "context",
				metadata: {
					day: nextClock.day,
					runtimeEventId: createClientId("runtime"),
				},
			}),
		);
	}
	if (conversation.capabilities.sceneEvents) {
		const scenes = list
			.filter((action) => action.tool === "emit_scene")
			.map((action) => sanitizeRuntimeText(action.arguments?.content, 800))
			.concat(
				advance ? [sanitizeRuntimeText(advance.arguments?.scene, 800)] : [],
			)
			.filter(Boolean)
			.slice(0, 2);
		for (const scene of scenes)
			items.push(
				makeItem(conversation, {
					kind: "scene",
					role: "system",
					speakerName: "Scene",
					content: scene,
					promptVisibility: "context",
					metadata: nextClock == null ? undefined : { day: nextClock.day },
				}),
			);
	}
	const stateAction = list.find(
		(action) => action.tool === "update_session_state",
	);
	if (stateAction && conversation.capabilities.sessionState && states) {
		const applied = applyStatePatches(states, stateAction.arguments?.patches);
		items.push(
			makeItem(conversation, {
				kind: "state_update",
				role: "system",
				speakerName: "System",
				content:
					sanitizeRuntimeText(stateAction.arguments?.note, 800) ||
					"Session state updated.",
				promptVisibility: "hidden",
				metadata: { day: nextClock?.day, patches: applied },
			}),
		);
	}
	return { items, clock: nextClock, states };
}

function restoreClockFromTimeline(
	conversationId: string,
	timeline: TimelineItem[],
) {
	let day = 1;
	for (const item of timeline) {
		if (item.kind !== "day_transition") continue;
		const value = item.metadata?.day;
		if (typeof value === "number" && Number.isFinite(value)) {
			day = Math.max(day, Math.trunc(value));
		}
	}
	return {
		conversationId,
		day,
		updatedAt: new Date().toISOString(),
	};
}

function makeItem(
	conversation: ConversationSummary,
	input: Omit<TimelineItem, "id" | "conversationId" | "createdAt">,
): TimelineItem {
	return {
		...input,
		id: createClientId("message"),
		conversationId: conversation.id,
		createdAt: new Date().toISOString(),
	};
}
async function requireConversation(id: string) {
	const conversation = await getConversationLocal(id);
	if (!conversation) throw new Error(`Conversation "${id}" was not found.`);
	return conversation;
}
function sanitizeMessage(value: unknown) {
	return sanitizeRuntimeText(value, 4000);
}
type StructuredRuntimeAction = {
	tool?: "advance_day" | "emit_scene" | "update_session_state";
	arguments?: {
		content?: string;
		scene?: string;
		note?: string;
		patches?: unknown;
	};
};
