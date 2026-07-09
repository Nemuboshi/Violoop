import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const defaultCorsOrigins = ["http://127.0.0.1:5173"];

const serverEnvSchema = z.object({
	host: z.string().min(1),
	port: z.number().int().min(1).max(65535),
	corsOrigins: z.array(z.string().min(1)),
	dataDir: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadDotEnv(path = resolve(process.cwd(), ".env")) {
	if (existsSync(path)) {
		process.loadEnvFile(path);
	}
}

export function parseServerEnv(
	env: NodeJS.ProcessEnv = process.env,
): ServerEnv {
	return serverEnvSchema.parse({
		host: env.VIOLOOP_HOST ?? "127.0.0.1",
		port: Number(env.VIOLOOP_PORT ?? 3000),
		corsOrigins: parseCsv(env.VIOLOOP_CORS_ORIGINS) ?? defaultCorsOrigins,
		dataDir: env.VIOLOOP_DATA_DIR ?? "data",
	});
}

function parseCsv(value: string | undefined) {
	const items = value
		?.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	return items && items.length > 0 ? items : undefined;
}
