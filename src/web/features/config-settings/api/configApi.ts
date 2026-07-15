import type {
	ConfigResponse,
	ConfigSaveResponse,
	VioloopConfig,
} from "../../../../shared/types";
import {
	getLocalConfigResponse,
	saveLocalConfig,
} from "../../../shared/storage/localData";

export async function fetchConfig(): Promise<ConfigResponse> {
	return getLocalConfigResponse();
}

export async function saveConfig(
	config: VioloopConfig,
): Promise<ConfigSaveResponse> {
	return saveLocalConfig(config);
}
