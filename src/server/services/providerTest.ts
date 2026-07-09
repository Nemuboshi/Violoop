import type {
	ActiveProvider,
	ChatUsage,
	ProviderConfig,
	ProviderTestResponse,
} from "../../shared/types";
import { getProviderAdapter } from "../providers";

export async function testProvider(
	providerId: string,
	providerConfig: ProviderConfig,
	modelId: string,
): Promise<ProviderTestResponse> {
	const model = providerConfig.models?.find((item) => item.id === modelId) ?? {
		id: modelId,
	};
	const api = model.api ?? providerConfig.api;
	const provider: ActiveProvider = {
		id: providerId,
		name: providerConfig.name ?? providerId,
		baseUrl: stripTrailingSlash(providerConfig.baseUrl),
		api,
		model,
		apiKey: providerConfig.apiKey,
		authHeader: providerConfig.authHeader ?? true,
		headers: providerConfig.headers ?? {},
		compat: { ...(providerConfig.compat ?? {}), ...(model.compat ?? {}) },
	};
	const adapter = getProviderAdapter(provider.api);
	let responseText = "";
	let usage: ChatUsage | undefined;

	for await (const event of adapter.streamChat({
		provider,
		messages: [{ role: "user", content: "Reply with OK." }],
		systemPrompt: "You are testing provider connectivity. Reply with OK.",
		temperature: 0,
	})) {
		if (event.type === "text") {
			responseText += event.text;
		}

		if (event.type === "usage") {
			usage = event.usage;
		}

		if (responseText.length >= 64) {
			break;
		}
	}

	return {
		ok: true,
		provider: provider.id,
		model: provider.model.id,
		text: responseText.trim(),
		usage,
	};
}

function stripTrailingSlash(value: string) {
	return value.replace(/\/+$/, "");
}
