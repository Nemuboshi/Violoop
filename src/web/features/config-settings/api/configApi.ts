import type {
	ConfigResponse,
	ConfigSaveResponse,
	VioloopConfig,
} from "../../../../shared/types";
import { fetchJson } from "../../../shared/api";
import {
	getLocalConfigResponse,
	hasIndexedDb,
	saveLocalConfig,
} from "../../../shared/storage/localData";

export async function fetchConfig() {
	if (hasIndexedDb()) return getLocalConfigResponse();
	return fetchJson<ConfigResponse>("/api/config");
}

export async function saveConfig(config: VioloopConfig) {
	if (hasIndexedDb()) return saveLocalConfig(config);
	return fetchJson<ConfigSaveResponse>("/api/config", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ config }),
	});
}
