import cors from "@fastify/cors";
import fastify, { type FastifyInstance } from "fastify";
import { HttpError } from "./httpErrors";
import { ProviderRequestError } from "./providers";
import { registerChatRoutes } from "./routes/chat";
import { registerConfigRoutes } from "./routes/config";
import { registerConversationRoutes } from "./routes/conversations";
import { registerProviderRoutes } from "./routes/providers";
import { registerTacticRoutes } from "./routes/tactics";
import { registerUsageRoutes } from "./routes/usage";

type BuildAppOptions = {
	corsOrigins: string[];
};

export async function buildApp(
	options: BuildAppOptions,
): Promise<FastifyInstance> {
	const app = fastify({
		bodyLimit: 1_000_000,
		logger: false,
	});

	await app.register(cors, {
		origin(origin, callback) {
			callback(
				null,
				origin === undefined || options.corsOrigins.includes(origin),
			);
		},
		methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization"],
		exposedHeaders: [],
	});

	app.setErrorHandler((error, _request, reply) => {
		if (error instanceof HttpError) {
			reply.status(error.statusCode).send(error.payload);
			return;
		}

		if (error instanceof ProviderRequestError) {
			reply.status(error.status).send({
				error: error.message,
				detail: error.detail.slice(0, 2000),
			});
			return;
		}

		const statusCode = isStatusError(error) ? error.statusCode : 500;
		const message =
			error instanceof Error && error.message
				? error.message
				: "Unexpected server error";
		reply.status(statusCode).send({ error: message });
	});

	await registerConfigRoutes(app);
	await registerProviderRoutes(app);
	await registerUsageRoutes(app);
	await registerConversationRoutes(app);
	await registerTacticRoutes(app);
	await registerChatRoutes(app);

	return app;
}

function isStatusError(error: unknown): error is { statusCode: number } {
	return (
		typeof error === "object" &&
		error !== null &&
		"statusCode" in error &&
		typeof error.statusCode === "number"
	);
}
