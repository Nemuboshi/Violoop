import type {
	StateDefinition,
	Tactic,
	TacticsMutationResponse,
	TacticsStatusResponse,
} from "../../../../shared/types";
import { fetchJson, fetchJsonOrNull } from "../../../shared/api";

export async function fetchTacticsStatus(conversationId?: string | null) {
	const search = conversationId
		? `?conversationId=${encodeURIComponent(conversationId)}`
		: "";
	return fetchJsonOrNull<TacticsStatusResponse>(`/api/tactics${search}`);
}

export async function saveTactic(input: {
	tactic: Tactic;
	originalId: string | null;
}) {
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
	return fetchJson<TacticsMutationResponse>(
		`/api/tactics/${encodeURIComponent(tacticId)}`,
		{ method: "DELETE" },
	);
}

export async function saveStateDefinition(input: {
	state: StateDefinition;
	originalId: string | null;
}) {
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
	return fetchJson<TacticsMutationResponse>(
		`/api/tactics/states/${encodeURIComponent(stateId)}`,
		{ method: "DELETE" },
	);
}
