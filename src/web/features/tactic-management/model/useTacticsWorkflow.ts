import { useState } from "react";
import type { SessionClock } from "../../../entities/session";
import type {
	StateDefinition,
	TacticOverview,
	TacticsStatusResponse,
} from "../../../entities/tactic";
import { fetchTacticsStatus } from "../../../entities/tactic";

type UseTacticsWorkflowOptions = {
	onClockChange?: (clock: SessionClock) => void;
};

export function useTacticsWorkflow(options: UseTacticsWorkflowOptions = {}) {
	const [tacticsStatus, setTacticsStatus] =
		useState<TacticsStatusResponse | null>(null);
	const [libraryTactics, setLibraryTactics] = useState<TacticOverview[]>([]);
	const [stateDefinitions, setStateDefinitions] = useState<StateDefinition[]>(
		[],
	);
	const [selectedTacticIds, setSelectedTacticIds] = useState<string[]>([]);

	function clearSessionStatus() {
		setTacticsStatus(null);
		setSelectedTacticIds([]);
	}

	async function refreshSessionStatus(conversationId?: string | null) {
		if (!conversationId) {
			clearSessionStatus();
			return null;
		}

		const nextStatus = await fetchTacticsStatus(conversationId);
		setTacticsStatus(nextStatus);
		setStateDefinitions(nextStatus?.stateDefinitions ?? []);
		setSelectedTacticIds(
			nextStatus?.tactics
				.filter((tactic) => tactic.allowedInSession)
				.map((tactic) => tactic.id) ?? [],
		);
		if (nextStatus?.clock) {
			options.onClockChange?.(nextStatus.clock);
		}

		return nextStatus;
	}

	async function refreshLibrary() {
		const nextStatus = await fetchTacticsStatus(null);
		const tactics = nextStatus?.tactics ?? [];
		setStateDefinitions(nextStatus?.stateDefinitions ?? []);
		setLibraryTactics(tactics);
		return tactics;
	}

	async function refreshLibraryStatus() {
		const nextStatus = await fetchTacticsStatus(null);
		setStateDefinitions(nextStatus?.stateDefinitions ?? []);
		setLibraryTactics(nextStatus?.tactics ?? []);
		return nextStatus;
	}

	return {
		tacticsStatus,
		libraryTactics,
		stateDefinitions,
		selectedTacticIds,
		clearSessionStatus,
		refreshSessionStatus,
		refreshLibrary,
		refreshLibraryStatus,
	};
}
