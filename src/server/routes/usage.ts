import type { FastifyInstance } from "fastify";
import { getUsage } from "../services/usageStore";

export async function registerUsageRoutes(app: FastifyInstance) {
	app.get("/api/usage/:requestId", async (request) => {
		const params = request.params as { requestId: string };
		return { requestId: params.requestId, usage: getUsage(params.requestId) };
	});
}
