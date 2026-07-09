import type { FastifyInstance } from "fastify";
import type {
	ProviderTestRequest,
	ProviderTestResponse,
} from "../../shared/types";
import { HttpError } from "../httpErrors";
import { testProvider } from "../services/providerTest";

export async function registerProviderRoutes(app: FastifyInstance) {
	app.post(
		"/api/providers/test",
		async (request): Promise<ProviderTestResponse> => {
			const body = request.body as ProviderTestRequest;
			if (!body.provider || !body.model) {
				throw new HttpError(400, "Provider and model are required.");
			}

			return testProvider(
				body.providerId ?? "draft",
				body.provider,
				body.model,
			);
		},
	);
}
