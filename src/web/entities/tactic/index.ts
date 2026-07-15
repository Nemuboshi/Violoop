export type {
	StateDefinition,
	Tactic,
	TacticEmotionKey,
	TacticEmotionOperator,
	TacticOverview,
	TacticsStatus,
	UserState,
} from "../../../shared/types";
export {
	deleteStateDefinition,
	deleteTactic,
	loadTacticsStatus,
	saveStateDefinition,
	saveTactic,
} from "./api/tacticsApi";
