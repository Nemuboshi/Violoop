import { useState } from "react";
import type {
	AppConfigSnapshot,
	VioloopConfig,
} from "../../../../shared/types";
import { testProviderConnection } from "../../../entities/provider";
import type { ResultPopoverResult } from "../../../shared/ui";
import {
	fromProviderEditorDraft,
	newProviderEditorDraft,
	type ProviderEditorDraft,
	slugifyProviderName,
	toProviderEditorDraft,
} from "./providerDraft";

type UseProviderWorkflowOptions = {
	config: AppConfigSnapshot | null;
	saveAppConfig: (config: VioloopConfig) => Promise<void>;
	setConfigError: (message: string) => void;
	setConfigSaving: (saving: boolean) => void;
};

export function useProviderWorkflow(options: UseProviderWorkflowOptions) {
	const [providerDraft, setProviderDraft] =
		useState<ProviderEditorDraft | null>(null);
	const [testingProvider, setTestingProvider] = useState(false);
	const [providerTestResult, setProviderTestResult] =
		useState<ResultPopoverResult | null>(null);
	const [providerTestOpen, setProviderTestOpen] = useState(false);

	function resetProviderTest() {
		setProviderTestResult(null);
		setProviderTestOpen(false);
	}

	function openProviderEditor(providerId: string) {
		const provider = options.config?.config.providers[providerId];
		if (!provider) {
			return;
		}

		resetProviderTest();
		setProviderDraft(toProviderEditorDraft(providerId, provider));
	}

	function openNewProviderEditor() {
		resetProviderTest();
		setProviderDraft(newProviderEditorDraft());
	}

	function closeProviderEditor() {
		setProviderDraft(null);
		resetProviderTest();
	}

	async function saveProviderDraft(nextDraft: ProviderEditorDraft) {
		const config = options.config;
		if (!config) {
			return;
		}

		options.setConfigSaving(true);
		options.setConfigError("");

		try {
			const providerId =
				nextDraft.originalId ?? slugifyProviderName(nextDraft.name);
			if (!providerId) {
				throw new Error("Provider name is required.");
			}

			if (!nextDraft.originalId && config.config.providers[providerId]) {
				throw new Error(`Provider "${providerId}" already exists.`);
			}

			const previousProvider = nextDraft.originalId
				? config.config.providers[nextDraft.originalId]
				: undefined;
			const nextProvider = fromProviderEditorDraft(nextDraft, previousProvider);
			const nextProviders = {
				...config.config.providers,
				[providerId]: nextProvider,
			};
			const nextModelIds = nextProvider.models.map((model) => model.id);
			const isActiveProvider =
				config.config.chat.defaultProvider === providerId;
			const nextDefaultModel =
				isActiveProvider &&
				!nextModelIds.includes(config.config.chat.defaultModel)
					? nextModelIds[0]
					: config.config.chat.defaultModel;

			await options.saveAppConfig({
				...config.config,
				chat: {
					...config.config.chat,
					defaultModel: nextDefaultModel,
				},
				providers: nextProviders,
			});
			setProviderDraft(null);
		} catch (caught) {
			options.setConfigError(
				caught instanceof Error ? caught.message : "Unable to save provider.",
			);
		} finally {
			options.setConfigSaving(false);
		}
	}

	async function deleteProvider(providerId: string) {
		const config = options.config;
		if (!config) {
			return;
		}

		options.setConfigSaving(true);
		options.setConfigError("");

		try {
			if (providerId === config.config.chat.defaultProvider) {
				throw new Error("Active provider cannot be deleted.");
			}

			const { [providerId]: _removed, ...nextProviders } =
				config.config.providers;
			await options.saveAppConfig({
				...config.config,
				providers: nextProviders,
			});
		} catch (caught) {
			options.setConfigError(
				caught instanceof Error ? caught.message : "Unable to delete provider.",
			);
		} finally {
			options.setConfigSaving(false);
		}
	}

	async function activateProvider(providerId: string) {
		const config = options.config;
		if (!config) {
			return;
		}

		const provider = config.config.providers[providerId];
		if (!provider) {
			return;
		}

		options.setConfigSaving(true);
		options.setConfigError("");

		try {
			const nextModel =
				provider.models?.[0]?.id ?? config.config.chat.defaultModel;
			await options.saveAppConfig({
				...config.config,
				chat: {
					...config.config.chat,
					defaultProvider: providerId,
					defaultModel: nextModel,
				},
			});
		} catch (caught) {
			options.setConfigError(
				caught instanceof Error ? caught.message : "Unable to switch provider.",
			);
		} finally {
			options.setConfigSaving(false);
		}
	}

	async function testProviderDraft(nextDraft: ProviderEditorDraft) {
		setTestingProvider(true);
		resetProviderTest();

		try {
			const provider = fromProviderEditorDraft(nextDraft);
			const model = provider.models[0].id;

			const result = await testProviderConnection({
				providerId: nextDraft.originalId ?? slugifyProviderName(nextDraft.name),
				provider,
				model,
			});
			setProviderTestResult({
				status: "success",
				title: "Provider is available",
				detail: `${result.model}${result.text ? ` / ${result.text}` : ""}`,
			});
			setProviderTestOpen(true);
		} catch (caught) {
			setProviderTestResult({
				status: "error",
				title: "Provider test failed",
				detail:
					caught instanceof Error ? caught.message : "Provider test failed.",
			});
			setProviderTestOpen(true);
		} finally {
			setTestingProvider(false);
		}
	}

	return {
		providerDraft,
		setProviderDraft,
		testingProvider,
		providerTestResult,
		providerTestOpen,
		setProviderTestOpen,
		openProviderEditor,
		openNewProviderEditor,
		closeProviderEditor,
		saveProviderDraft,
		deleteProvider,
		activateProvider,
		testProviderDraft,
	};
}
