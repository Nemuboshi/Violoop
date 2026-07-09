import type { FastifyInstance } from "fastify";
import type {
	ConfigResponse,
	ConfigSaveResponse,
	VioloopConfig,
} from "../../shared/types";
import { loadConfig, resolveActiveProvider, saveConfig } from "../config";
import { HttpError } from "../httpErrors";

export async function registerConfigRoutes(app: FastifyInstance) {
	app.get("/api/health", async () => ({ ok: true }));

	app.get("/api/config", async (): Promise<ConfigResponse> => {
		const config = await loadConfig();
		const provider = resolveActiveProvider(config);
		return {
			config,
			provider: provider.id,
			providerName: provider.name,
			baseUrl: provider.baseUrl,
			api: provider.api,
			model: provider.model.id,
			cache: {
				systemPrompt: config.chat.cache?.systemPrompt ?? false,
				cacheControlFormat: provider.compat.cacheControlFormat,
				usageInStreaming: provider.compat.supportsUsageInStreaming !== false,
			},
		};
	});

	app.put("/api/config", async (request): Promise<ConfigSaveResponse> => {
		const body = request.body as { config?: VioloopConfig };
		if (!body.config) {
			throw new HttpError(400, "Config payload is required.");
		}

		return { config: await saveConfig(body.config) };
	});
}
