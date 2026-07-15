import type {
	AppConfigSnapshot,
	SavedConfig,
	VioloopConfig,
} from "../../../../shared/types";
import { getLocalConfig, saveLocalConfig } from "../../../shared/storage";

export async function loadConfig(): Promise<AppConfigSnapshot> {
	return getLocalConfig();
}

export async function saveConfig(config: VioloopConfig): Promise<SavedConfig> {
	return saveLocalConfig(config);
}
