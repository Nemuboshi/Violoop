import type { ChatProviderAdapter, ProviderApi } from "../../shared/types";
import { openAiCompletionsAdapter } from "./openaiCompletions";

const adapters: Record<ProviderApi, ChatProviderAdapter> = {
	"openai-completions": openAiCompletionsAdapter,
};

export function getProviderAdapter(api: ProviderApi) {
	const adapter = adapters[api];
	if (!adapter) {
		throw new Error(`Provider API "${api}" is not supported.`);
	}

	return adapter;
}

export { ProviderRequestError } from "./openaiCompletions";
