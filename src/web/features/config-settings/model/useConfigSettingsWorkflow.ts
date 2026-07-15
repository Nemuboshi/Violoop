import { useState } from "react";
import type { ConfigResponse, VioloopConfig } from "../../../../shared/types";
import { loadConfig, saveConfig } from "../api/configApi";
import { fromSettingsDraft, toSettingsDraft } from "./configDraft";

type UseConfigSettingsWorkflowOptions = {
	refreshTacticLibrary: () => Promise<unknown>;
};

export function useConfigSettingsWorkflow(
	options: UseConfigSettingsWorkflowOptions,
) {
	const [config, setConfig] = useState<ConfigResponse | null>(null);
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState<ReturnType<typeof toSettingsDraft> | null>(
		null,
	);
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);

	async function refreshConfig() {
		const payload = await loadConfig();
		setConfig(payload);
		setDraft(toSettingsDraft(payload.config));
		return payload;
	}

	async function openConfigModal() {
		setOpen(true);
		await options.refreshTacticLibrary();
	}

	async function saveAppConfig(nextConfig: VioloopConfig) {
		await saveConfig(nextConfig);
		await refreshConfig();
	}

	async function saveSettingsDraft() {
		if (!config || !draft) {
			return;
		}

		setSaving(true);
		setError("");

		try {
			await saveAppConfig(fromSettingsDraft(config.config, draft));
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "Unable to save config.",
			);
		} finally {
			setSaving(false);
		}
	}

	return {
		config,
		open,
		setOpen,
		draft,
		setDraft,
		error,
		setError,
		saving,
		setSaving,
		refreshConfig,
		openConfigModal,
		saveAppConfig,
		saveSettingsDraft,
	};
}
