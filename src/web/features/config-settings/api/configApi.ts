import type {
	ConfigResponse,
	ConfigSaveResponse,
	VioloopConfig,
} from "../../../../shared/types";
import { fetchJson } from "../../../shared/api";

export async function fetchConfig() {
	return fetchJson<ConfigResponse>("/api/config");
}

export async function saveConfig(config: VioloopConfig) {
	return fetchJson<ConfigSaveResponse>("/api/config", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ config }),
	});
}
