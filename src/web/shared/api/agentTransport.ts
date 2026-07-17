import { streamOpenAiCompletions } from "../../../shared/infra/openaiCompletions";
import type {
	ActiveProvider,
	ChatUsage,
	PromptBlock,
	ProviderConfig,
	ProviderTestRequest,
	ProviderTestResponse,
	StreamChatOptions,
	ThinkingLevel,
	VioloopConfig,
} from "../../../shared/types";
import { fetchJson } from "./client";

export type AgentRequest = {
	provider: ActiveProvider;
	messages: StreamChatOptions["messages"];
	promptBlocks: PromptBlock[];
	temperature?: number;
	thinkingLevel?: ThinkingLevel;
	cache?: VioloopConfig["chat"]["cache"];
};

type AgentResponse = { text: string; usage?: ChatUsage };

export async function requestAgent(
	input: AgentRequest,
): Promise<AgentResponse> {
	const modes = transportAttempts(input.provider.transport);
	let firstError: unknown;
	for (const mode of modes) {
		try {
			return mode === "browser"
				? await requestBrowserAgent(input)
				: await requestWorkerAgent(input);
		} catch (error) {
			firstError ??= error;
		}
	}
	throw firstError instanceof Error
		? firstError
		: new Error("Agent request failed.");
}

export async function testAgentProvider(
	input: Required<
		Pick<ProviderTestRequest, "providerId" | "provider" | "model">
	> & { provider: ProviderConfig },
): Promise<ProviderTestResponse> {
	const modes = transportAttempts(input.provider.transport);
	let firstError: unknown;
	for (const mode of modes) {
		try {
			if (mode === "worker") return requestWorkerProviderTest(input);
			const provider = toActiveProvider(input);
			const response = await requestBrowserAgent({
				provider,
				messages: [{ role: "user", content: "Reply with OK." }],
				promptBlocks: [
					{
						label: "stable-system",
						cacheScope: "stable",
						content: "You are testing provider connectivity. Reply with OK.",
					},
				],
				temperature: 0,
			});
			return {
				ok: true,
				provider: provider.id,
				model: provider.model.id,
				text: response.text.trim().slice(0, 64),
				usage: response.usage,
			};
		} catch (error) {
			firstError ??= error;
		}
	}
	throw firstError instanceof Error
		? firstError
		: new Error("Provider test failed.");
}

function requestWorkerProviderTest(
	input: Required<
		Pick<ProviderTestRequest, "providerId" | "provider" | "model">
	> & { provider: ProviderConfig },
) {
	return fetchJson<ProviderTestResponse>(
		"/api/providers/test",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		},
		{ errorMessage: readProviderTestError },
	);
}

function toActiveProvider(
	input: Required<
		Pick<ProviderTestRequest, "providerId" | "provider" | "model">
	> & { provider: ProviderConfig },
): ActiveProvider {
	const model = input.provider.models?.find(
		(item) => item.id === input.model,
	) ?? {
		id: input.model,
	};
	return {
		id: input.providerId,
		name: input.provider.name ?? input.providerId,
		baseUrl: input.provider.baseUrl.replace(/\/+$/, ""),
		api: input.provider.api,
		model,
		apiKey: input.provider.apiKey,
		authHeader: input.provider.authHeader ?? true,
		headers: input.provider.headers ?? {},
		compat: { ...(input.provider.compat ?? {}), ...(model.compat ?? {}) },
		transport: input.provider.transport,
	};
}

function readProviderTestError(
	status: number,
	payload: Record<string, unknown> | null,
) {
	const error = typeof payload?.error === "string" ? payload.error : undefined;
	const detail =
		typeof payload?.detail === "string" && payload.detail.trim()
			? payload.detail.trim()
			: undefined;
	if (error && detail && detail !== error) return `${error}\n${detail}`;
	return error ?? detail ?? `Provider test failed with ${status}`;
}

function transportAttempts(
	transport: ActiveProvider["transport"],
): Array<"browser" | "worker"> {
	switch (transport) {
		case "browser":
			return ["browser"];
		case "browser-fallback-worker":
			return ["browser", "worker"];
		case "worker-fallback-browser":
			return ["worker", "browser"];
		default:
			return ["worker"];
	}
}

async function requestWorkerAgent(input: AgentRequest): Promise<AgentResponse> {
	return fetchJson<AgentResponse>("/api/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
}

async function requestBrowserAgent(
	input: AgentRequest,
): Promise<AgentResponse> {
	let text = "";
	let usage: ChatUsage | undefined;
	for await (const event of streamOpenAiCompletions(input)) {
		if (event.type === "text") text += event.text;
		if (event.type === "usage") usage = event.usage;
	}
	return { text, usage };
}
