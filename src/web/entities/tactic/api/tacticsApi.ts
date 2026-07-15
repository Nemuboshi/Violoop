import type {
	StateDefinition,
	Tactic,
	TacticsLibrarySnapshot,
	TacticsStatus,
} from "../../../../shared/types";
import {
	getLocalTacticsStatus,
	removeLocalState,
	removeLocalTactic,
	saveLocalState,
	saveLocalTactic,
} from "../../../shared/storage";

export async function loadTacticsStatus(conversationId?: string | null) {
	return getLocalTacticsStatus(conversationId);
}

export async function saveTactic(input: {
	tactic: Tactic;
	originalId: string | null;
}): Promise<TacticsLibrarySnapshot> {
	return saveLocalTactic(input.tactic, input.originalId);
}

export async function deleteTactic(
	tacticId: string,
): Promise<TacticsLibrarySnapshot> {
	return removeLocalTactic(tacticId);
}

export async function saveStateDefinition(input: {
	state: StateDefinition;
	originalId: string | null;
}): Promise<TacticsLibrarySnapshot> {
	return saveLocalState(input.state, input.originalId);
}

export async function deleteStateDefinition(
	stateId: string,
): Promise<TacticsLibrarySnapshot> {
	return removeLocalState(stateId);
}

export type { TacticsStatus };
