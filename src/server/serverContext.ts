import { resolve } from "node:path";
import { parseServerEnv, type ServerEnv } from "./env";

export type ServerPaths = {
	dataDir: string;
	settingsPath: string;
	tacticsPath: string;
	stateDefinitionsPath: string;
	conversationLogPath: string;
};

export type ServerContext = ServerEnv & {
	paths: ServerPaths;
};

let currentContext: ServerContext | undefined;

export function configureServerContext(env: ServerEnv = parseServerEnv()) {
	const dataDir = resolve(env.dataDir);
	currentContext = {
		...env,
		dataDir,
		paths: {
			dataDir,
			settingsPath: resolve(dataDir, "settings.json"),
			tacticsPath: resolve(dataDir, "tactics.json"),
			stateDefinitionsPath: resolve(dataDir, "states.json"),
			conversationLogPath: resolve(dataDir, "conversations.jsonl"),
		},
	};
	return currentContext;
}

export function getServerContext() {
	currentContext ??= configureServerContext();
	return currentContext;
}

export function getServerPaths() {
	return getServerContext().paths;
}
