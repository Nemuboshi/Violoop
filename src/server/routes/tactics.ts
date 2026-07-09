import type { FastifyInstance } from "fastify";
import type {
	StateDefinition,
	TacticsMutationResponse,
	TacticsStatusResponse,
} from "../../shared/types";
import { HttpError } from "../httpErrors";
import { ensureSessionClock } from "../runtime";
import {
	createStateDefinition,
	createTactic,
	deleteStateDefinition,
	deleteTactic,
	listRecentTacticRuns,
	listStateDefinitions,
	listTacticsOverview,
	listUserState,
	updateStateDefinition,
	updateTactic,
} from "../tactics";

export async function registerTacticRoutes(app: FastifyInstance) {
	app.get("/api/tactics", async (request): Promise<TacticsStatusResponse> => {
		const conversationId = (request.query as { conversationId?: string })
			.conversationId;
		return {
			conversationId,
			tactics: await listTacticsOverview(conversationId),
			stateDefinitions: await listStateDefinitions(),
			userState: await listUserState(conversationId),
			clock: conversationId ? await ensureSessionClock(conversationId) : null,
			recentRuns: await listRecentTacticRuns(conversationId, 10),
		};
	});

	app.post(
		"/api/tactics",
		async (request): Promise<TacticsMutationResponse> => {
			const body = request.body as {
				tactic?: Parameters<typeof createTactic>[0];
			};
			if (!body.tactic) {
				throw new HttpError(400, "Tactic payload is required.");
			}
			return {
				tactics: await createTactic(body.tactic),
				stateDefinitions: await listStateDefinitions(),
			};
		},
	);

	app.put(
		"/api/tactics/:tacticId",
		async (request): Promise<TacticsMutationResponse> => {
			const { tacticId } = request.params as { tacticId: string };
			const body = request.body as {
				tactic?: Parameters<typeof updateTactic>[1];
			};
			if (!body.tactic) {
				throw new HttpError(400, "Tactic payload is required.");
			}
			return {
				tactics: await updateTactic(tacticId, body.tactic),
				stateDefinitions: await listStateDefinitions(),
			};
		},
	);

	app.delete(
		"/api/tactics/:tacticId",
		async (request): Promise<TacticsMutationResponse> => {
			const { tacticId } = request.params as { tacticId: string };
			return {
				tactics: await deleteTactic(tacticId),
				stateDefinitions: await listStateDefinitions(),
			};
		},
	);

	app.post(
		"/api/tactics/states",
		async (request): Promise<TacticsMutationResponse> => {
			const body = request.body as { state?: StateDefinition };
			if (!body.state) {
				throw new HttpError(400, "State payload is required.");
			}
			return {
				tactics: await listTacticsOverview(),
				stateDefinitions: await createStateDefinition(body.state),
			};
		},
	);

	app.put(
		"/api/tactics/states/:stateId",
		async (request): Promise<TacticsMutationResponse> => {
			const { stateId } = request.params as { stateId: string };
			const body = request.body as { state?: StateDefinition };
			if (!body.state) {
				throw new HttpError(400, "State payload is required.");
			}
			return {
				tactics: await listTacticsOverview(),
				stateDefinitions: await updateStateDefinition(stateId, body.state),
			};
		},
	);

	app.delete(
		"/api/tactics/states/:stateId",
		async (request): Promise<TacticsMutationResponse> => {
			const { stateId } = request.params as { stateId: string };
			return {
				tactics: await listTacticsOverview(),
				stateDefinitions: await deleteStateDefinition(stateId),
			};
		},
	);
}
