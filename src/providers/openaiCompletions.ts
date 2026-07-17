import { streamOpenAiCompletions } from "../shared/infra/openaiCompletions";
import type { ChatProviderAdapter } from "../shared/types";

export { ProviderRequestError } from "../shared/infra/openaiCompletions";

export const openAiCompletionsAdapter: ChatProviderAdapter = {
	streamChat: streamOpenAiCompletions,
};
