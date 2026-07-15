import { useState } from "react";
import {
	type ConversationPayload,
	createConversation,
} from "../../../entities/conversation";
import {
	defaultNewChatDraft,
	defaultSessionCapabilities,
	type SessionCapabilities,
	type SessionProfile,
	toSessionCapabilities,
	toSessionProfile,
} from "../../../entities/session";
import type {
	StateDefinition,
	TacticOverview,
	TacticsStatusResponse,
} from "../../../entities/tactic";

export type NewChatDraft = SessionProfile &
	SessionCapabilities & {
		title: string;
	};

type UseNewChatWorkflowOptions = {
	refreshTacticLibraryStatus: () => Promise<TacticsStatusResponse | null>;
	onConversationCreated: (payload: ConversationPayload) => void;
	onRefreshConversations: () => Promise<unknown>;
	onRefreshTactics: (conversationId: string) => Promise<unknown>;
};

export function useNewChatWorkflow(options: UseNewChatWorkflowOptions) {
	const [open, setOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [draft, setDraft] = useState<NewChatDraft>(
		defaultNewChatDraftWithTitle(),
	);
	const [error, setError] = useState("");
	const [availableTactics, setAvailableTactics] = useState<TacticOverview[]>(
		[],
	);
	const [stateDefinitions, setStateDefinitions] = useState<StateDefinition[]>(
		[],
	);
	const [selectedTacticIds, setSelectedTacticIds] = useState<string[]>([]);
	const [selectedStateIds, setSelectedStateIds] = useState<string[]>([]);

	function reset() {
		setDraft(defaultNewChatDraftWithTitle());
		setError("");
	}

	async function openNewChatModal() {
		const status = await options.refreshTacticLibraryStatus();
		const tactics = status?.tactics ?? [];
		const states = status?.stateDefinitions ?? [];
		setAvailableTactics(tactics);
		setStateDefinitions(states);
		setSelectedTacticIds(tactics.map((tactic) => tactic.id));
		setSelectedStateIds(states.map((state) => state.id));
		reset();
		setOpen(true);
	}

	function setTacticAllowed(tacticId: string, enabled: boolean) {
		setSelectedTacticIds((current) => {
			const next = enabled
				? [...new Set([...current, tacticId])]
				: current.filter((id) => id !== tacticId);
			syncSessionStateForTactics(next);
			return next;
		});
	}

	function setStateEnabled(stateId: string, enabled: boolean) {
		setSelectedStateIds((current) => {
			const required = requiredStateIdsForTactics(
				selectedTacticIds,
				availableTactics,
			);
			if (!enabled && required.includes(stateId)) {
				setDraft((currentDraft) => ({ ...currentDraft, sessionState: true }));
				return current;
			}

			const next = enabled
				? [...new Set([...current, stateId])]
				: current.filter((id) => id !== stateId);
			if (required.length > 0) {
				setDraft((currentDraft) => ({ ...currentDraft, sessionState: true }));
				return [...new Set([...next, ...required])];
			}
			return next;
		});
	}

	async function startNewConversation() {
		setSaving(true);
		setError("");

		try {
			const requiredStateIds = requiredStateIdsForTactics(
				selectedTacticIds,
				availableTactics,
			);
			const sessionState = draft.sessionState || requiredStateIds.length > 0;
			const enabledStateIds = sessionState
				? [...new Set([...selectedStateIds, ...requiredStateIds])]
				: [];
			const created = await createConversation({
				title: draft.title,
				profile: toSessionProfile(draft),
				capabilities: toSessionCapabilities({ ...draft, sessionState }),
				allowedTacticIds: draft.tactics ? selectedTacticIds : [],
				enabledStateIds,
			});
			options.onConversationCreated(created);
			await options.onRefreshConversations();
			await options.onRefreshTactics(created.conversation.id);
			setOpen(false);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "Unable to start chat.",
			);
		} finally {
			setSaving(false);
		}
	}

	return {
		open,
		setOpen,
		saving,
		draft,
		setDraft,
		error,
		stateDefinitions,
		selectedTacticIds,
		selectedStateIds,
		openNewChatModal,
		setTacticAllowed,
		setStateEnabled,
		startNewConversation,
	};

	function syncSessionStateForTactics(tacticIds: string[]) {
		const required = requiredStateIdsForTactics(tacticIds, availableTactics);
		if (required.length === 0) {
			return;
		}

		setDraft((current) => ({ ...current, sessionState: true }));
		setSelectedStateIds((current) => [...new Set([...current, ...required])]);
	}
}

function defaultNewChatDraftWithTitle(): NewChatDraft {
	return {
		title: "New chat",
		...defaultNewChatDraft(),
		...defaultSessionCapabilities,
	};
}

function requiredStateIdsForTactics(
	selectedTacticIds: string[],
	tactics: TacticOverview[],
) {
	return [
		...new Set(
			tactics
				.filter((tactic) => selectedTacticIds.includes(tactic.id))
				.flatMap((tactic) => tactic.requiredStateIds),
		),
	].sort();
}
