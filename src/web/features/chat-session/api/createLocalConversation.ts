import type {
	ConversationPayload,
	ConversationSummary,
	CreateConversationRequest,
	SessionCapabilities,
	SessionClock,
	SessionProfile,
} from "../../../../shared/types";
import { createClientId } from "../../../shared/lib";
import {
	appendLocalItemsAtomic,
	defaultStates,
	deleteConversationLocal,
	ensureLocalSeed,
	listTacticsLocal,
	normalizeTitle,
	requiredStateIds,
	saveConversationLocal,
	saveSessionClockLocal,
	saveSessionTacticIdsLocal,
	saveSessionUserStateLocal,
} from "../../../shared/storage";
import { createLocalOpeningTimeline } from "./openingTimeline";

const defaultProfile: SessionProfile = {
	assistantName: "Violoop",
	userRole: "The user is asking for practical help.",
	assistantRole: "A concise assistant that answers directly.",
};
const defaultCapabilities: SessionCapabilities = {
	tactics: true,
	dayProgression: false,
	sessionState: false,
	sceneEvents: false,
};

export async function createLocalConversation(
	input: Pick<
		CreateConversationRequest,
		"title" | "profile" | "capabilities"
	> & {
		allowedTacticIds?: string[];
		enabledStateIds?: string[];
	},
): Promise<ConversationPayload> {
	await ensureLocalSeed();
	const now = new Date().toISOString();
	const id = createClientId("conversation");
	const profile = normalizeProfile(input.profile);
	const requestedCapabilities = normalizeCapabilities(input.capabilities);
	const selectedTacticIds = requestedCapabilities.tactics
		? await validateTacticSelection(input.allowedTacticIds)
		: [];
	const requiredSelectionStateIds =
		await requiredStateIdsForSelection(selectedTacticIds);
	const capabilities = normalizeCapabilities({
		...requestedCapabilities,
		sessionState:
			requestedCapabilities.sessionState ||
			requiredSelectionStateIds.length > 0,
	});
	const conversation: ConversationSummary = {
		id,
		title: normalizeTitle(input.title),
		profile,
		capabilities,
		createdAt: now,
		updatedAt: now,
		messageCount: 0,
	};
	let clock: SessionClock | null = null;
	if (capabilities.dayProgression) {
		clock = { conversationId: id, day: 1, updatedAt: now };
	}
	const sessionStates = capabilities.sessionState
		? await defaultStates([
				...(input.enabledStateIds || []),
				...requiredSelectionStateIds,
			])
		: null;
	const timelineItems = await createLocalOpeningTimeline(conversation);
	try {
		await saveConversationLocal(conversation);
		await saveSessionTacticIdsLocal(id, selectedTacticIds);
		if (sessionStates) await saveSessionUserStateLocal(id, sessionStates);
		if (clock) await saveSessionClockLocal(clock);
		if (timelineItems.length)
			await appendLocalItemsAtomic(conversation, timelineItems);
	} catch (error) {
		await deleteConversationLocal(id);
		throw error;
	}
	return {
		conversation: {
			...conversation,
			messageCount: timelineItems.filter(
				(item) => item.promptVisibility !== "hidden",
			).length,
			updatedAt: timelineItems.at(-1)?.createdAt ?? conversation.updatedAt,
		},
		clock,
		timelineItems,
	};
}

async function validateTacticSelection(ids: string[] | undefined) {
	const tactics = await listTacticsLocal();
	const selected = tactics.filter((tactic) =>
		(ids ?? tactics.map((item) => item.id)).includes(tactic.id),
	);
	return selected.map((tactic) => tactic.id);
}

async function requiredStateIdsForSelection(ids: string[]) {
	const tactics = await listTacticsLocal();
	return [
		...new Set(
			tactics
				.filter((tactic) => ids.includes(tactic.id))
				.flatMap(requiredStateIds),
		),
	];
}

function normalizeProfile(profile?: SessionProfile | null): SessionProfile {
	return {
		assistantName: normalizeText(
			profile?.assistantName,
			defaultProfile.assistantName,
			80,
		),
		userRole: normalizeText(profile?.userRole, defaultProfile.userRole, 1000),
		assistantRole: normalizeText(
			profile?.assistantRole,
			defaultProfile.assistantRole,
			1000,
		),
	};
}
function normalizeCapabilities(
	capabilities?: Partial<SessionCapabilities> | null,
): SessionCapabilities {
	return { ...defaultCapabilities, ...capabilities };
}
function normalizeText(
	value: string | undefined | null,
	fallback: string,
	max: number,
) {
	const normalized = String(value ?? "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, max);
	return normalized || fallback;
}
