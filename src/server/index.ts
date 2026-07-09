import { buildApp } from "./app";
import {
	initializeConfigStore,
	loadConfig,
	resolveActiveProvider,
} from "./config";
import { loadDotEnv, parseServerEnv } from "./env";
import { configureServerContext } from "./serverContext";
import { initializeTacticStore } from "./tactics";

loadDotEnv();
const serverEnv = parseServerEnv();
configureServerContext(serverEnv);

await initializeConfigStore();
await initializeTacticStore();

const startupConfig = await loadConfig();
const app = await buildApp({ corsOrigins: serverEnv.corsOrigins });

await app.listen({
	host: serverEnv.host,
	port: serverEnv.port,
});

const provider = resolveActiveProvider(startupConfig);
console.log(
	`Violoop API listening at http://${serverEnv.host}:${serverEnv.port}`,
);
console.log(
	`Using ${provider.model.id} via ${provider.name} (${provider.api}) at ${provider.baseUrl}`,
);
