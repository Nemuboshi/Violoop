import type {
	StateDefinition,
	Tactic,
	TacticsMutationResponse,
	TacticsStatusResponse,
} from "../../../../shared/types";
import {
	getLocalTacticsStatus,
	removeLocalState,
	removeLocalTactic,
	saveLocalState,
	saveLocalTactic,
} from "../../../shared/storage/localData";

export async function fetchTacticsStatus(conversationId?: string | null) {
	return getLocalTacticsStatus(conversationId);
}

export async function saveTactic(input: {
	tactic: Tactic;
	originalId: string | null;
}): Promise<TacticsMutationResponse> {
	return saveLocalTactic(input.tactic, input.originalId);
}

export async function deleteTactic(
	tacticId: string,
): Promise<TacticsMutationResponse> {
	return removeLocalTactic(tacticId);
}

export async function saveStateDefinition(input: {
	state: StateDefinition;
	originalId: string | null;
}): Promise<TacticsMutationResponse> {
	return saveLocalState(input.state, input.originalId);
}

export async function deleteStateDefinition(
	stateId: string,
): Promise<TacticsMutationResponse> {
	return removeLocalState(stateId);
}

export type { TacticsStatusResponse };
