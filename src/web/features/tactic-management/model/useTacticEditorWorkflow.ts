import { useState } from "react";
import type { StateDefinition } from "../../../entities/tactic";
import {
	deleteStateDefinition as deleteStateDefinitionRequest,
	deleteTactic as deleteTacticRequest,
	saveStateDefinition,
	saveTactic,
} from "../../../entities/tactic";
import {
	fromTacticEditorDraft,
	newTacticEditorDraft,
	type TacticEditorDraft,
	toTacticEditorDraft,
} from "./tacticDraft";

type UseTacticEditorWorkflowOptions = {
	activeConversationId: string | null;
	refreshTacticLibrary: () => Promise<unknown>;
	refreshSessionTactics: (conversationId: string) => Promise<unknown>;
	setConfigError: (message: string) => void;
};

export function useTacticEditorWorkflow(
	options: UseTacticEditorWorkflowOptions,
) {
	const [tacticDraft, setTacticDraft] = useState<TacticEditorDraft | null>(
		null,
	);
	const [savingTactic, setSavingTactic] = useState(false);

	async function refreshAfterMutation() {
		await options.refreshTacticLibrary();
		if (options.activeConversationId) {
			await options.refreshSessionTactics(options.activeConversationId);
		}
	}

	async function saveTacticDraft(draft: TacticEditorDraft) {
		options.setConfigError("");
		setSavingTactic(true);

		try {
			await saveTactic({
				tactic: fromTacticEditorDraft(draft),
				originalId: draft.originalId,
			});
			await refreshAfterMutation();
			setTacticDraft(null);
		} catch (caught) {
			options.setConfigError(
				caught instanceof Error ? caught.message : "Unable to update tactic.",
			);
		} finally {
			setSavingTactic(false);
		}
	}

	async function deleteTactic(tacticId: string) {
		options.setConfigError("");
		setSavingTactic(true);

		try {
			await deleteTacticRequest(tacticId);
			await refreshAfterMutation();
			setTacticDraft(null);
		} catch (caught) {
			options.setConfigError(
				caught instanceof Error ? caught.message : "Unable to delete tactic.",
			);
		} finally {
			setSavingTactic(false);
		}
	}

	async function saveStateDefinitionDraft(
		state: StateDefinition,
		originalId: string | null,
	) {
		options.setConfigError("");
		setSavingTactic(true);

		try {
			await saveStateDefinition({ state, originalId });
			await options.refreshTacticLibrary();
		} catch (caught) {
			options.setConfigError(
				caught instanceof Error ? caught.message : "Unable to update state.",
			);
		} finally {
			setSavingTactic(false);
		}
	}

	async function deleteStateDefinition(stateId: string) {
		options.setConfigError("");
		setSavingTactic(true);

		try {
			await deleteStateDefinitionRequest(stateId);
			await options.refreshTacticLibrary();
		} catch (caught) {
			options.setConfigError(
				caught instanceof Error ? caught.message : "Unable to delete state.",
			);
		} finally {
			setSavingTactic(false);
		}
	}

	return {
		tacticDraft,
		setTacticDraft,
		savingTactic,
		openNewTacticEditor: () => setTacticDraft(newTacticEditorDraft()),
		openTacticEditor: (tactic: Parameters<typeof toTacticEditorDraft>[0]) =>
			setTacticDraft(toTacticEditorDraft(tactic)),
		saveTacticDraft,
		deleteTactic,
		saveStateDefinitionDraft,
		deleteStateDefinition,
	};
}
