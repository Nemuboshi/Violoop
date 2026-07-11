import type {
	StateDefinition,
	Tactic,
	TacticsMutationResponse,
	TacticsStatusResponse,
} from "../../../../shared/types";
import { fetchJson, fetchJsonOrNull } from "../../../shared/api";
import {
	getLocalTacticsStatus,
	hasIndexedDb,
	removeLocalState,
	removeLocalTactic,
	saveLocalState,
	saveLocalTactic,
} from "../../../shared/storage/localData";

export async function fetchTacticsStatus(conversationId?: string | null) {
	if (hasIndexedDb()) return getLocalTacticsStatus(conversationId);
	const search = conversationId
		? `?conversationId=${encodeURIComponent(conversationId)}`
		: "";
	return fetchJsonOrNull<TacticsStatusResponse>(`/api/tactics${search}`);
}

export async function saveTactic(input: {
	tactic: Tactic;
	originalId: string | null;
}) {
	if (hasIndexedDb()) return saveLocalTactic(input.tactic, input.originalId);
	const isNew = input.originalId === null;
	const targetId = input.originalId ?? "";
	return fetchJson<TacticsMutationResponse>(
		isNew ? "/api/tactics" : `/api/tactics/${encodeURIComponent(targetId)}`,
		{
			method: isNew ? "POST" : "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tactic: input.tactic }),
		},
	);
}

export async function deleteTactic(tacticId: string) {
	if (hasIndexedDb()) return removeLocalTactic(tacticId);
	return fetchJson<TacticsMutationResponse>(
		`/api/tactics/${encodeURIComponent(tacticId)}`,
		{ method: "DELETE" },
	);
}

export async function saveStateDefinition(input: {
	state: StateDefinition;
	originalId: string | null;
}) {
	if (hasIndexedDb()) return saveLocalState(input.state, input.originalId);
	const isNew = input.originalId === null;
	const targetId = input.originalId ?? "";
	return fetchJson<TacticsMutationResponse>(
		isNew
			? "/api/tactics/states"
			: `/api/tactics/states/${encodeURIComponent(targetId)}`,
		{
			method: isNew ? "POST" : "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ state: input.state }),
		},
	);
}

export async function deleteStateDefinition(stateId: string) {
	if (hasIndexedDb()) return removeLocalState(stateId);
	return fetchJson<TacticsMutationResponse>(
		`/api/tactics/states/${encodeURIComponent(stateId)}`,
		{ method: "DELETE" },
	);
}
