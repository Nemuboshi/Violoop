import { useState } from "react";
import {
	type ConversationPayload,
	createConversation,
} from "../../../entities/conversation";
import {
	defaultNewChatDraft,
	type SessionProfile,
	toSessionProfile,
} from "../../../entities/session";
import type {
	StateDefinition,
	TacticOverview,
	TacticsStatusResponse,
} from "../../../entities/tactic";

export type NewChatDraft = SessionProfile & {
	title: string;
};

type UseNewChatWorkflowOptions = {
	refreshTacticLibraryStatus: () => Promise<TacticsStatusResponse | null>;
	onConversationCreated: (payload: ConversationPayload) => void;
	onRefreshConversations: () => Promise<void>;
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
		setSelectedTacticIds((current) =>
			enabled
				? [...new Set([...current, tacticId])]
				: current.filter((id) => id !== tacticId),
		);
	}

	function setStateEnabled(stateId: string, enabled: boolean) {
		setSelectedStateIds((current) =>
			enabled
				? [...new Set([...current, stateId])]
				: current.filter((id) => id !== stateId),
		);
	}

	async function startNewConversation() {
		setSaving(true);
		setError("");

		try {
			const missingStateIds = missingRequiredStateIds(
				selectedTacticIds,
				selectedStateIds,
				availableTactics,
			);
			if (missingStateIds.length > 0) {
				throw new Error(
					`Selected tactics require missing session states: ${missingStateIds.join(", ")}.`,
				);
			}
			const created = await createConversation({
				title: draft.title,
				profile: toSessionProfile(draft),
				allowedTacticIds: selectedTacticIds,
				enabledStateIds: selectedStateIds,
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
}

function defaultNewChatDraftWithTitle(): NewChatDraft {
	return {
		title: "New chat",
		...defaultNewChatDraft(),
	};
}

function missingRequiredStateIds(
	selectedTacticIds: string[],
	selectedStateIds: string[],
	tactics: TacticOverview[],
) {
	const selectedStates = new Set(selectedStateIds);
	return [
		...new Set(
			tactics
				.filter((tactic) => selectedTacticIds.includes(tactic.id))
				.flatMap((tactic) => tactic.requiredStateIds),
		),
	]
		.filter((stateId) => !selectedStates.has(stateId))
		.sort();
}
