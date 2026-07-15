import { describe, expect, it, vi } from "vitest";
import { testProvider } from "../../src/providers/providerTest";

describe("testProvider", () => {
	it("captures usage events and stops after enough text", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				const body = [
					`data: ${JSON.stringify({
						choices: [{ delta: { content: "OK" } }],
					})}`,
					`data: ${JSON.stringify({
						usage: {
							prompt_tokens: 3,
							completion_tokens: 2,
							total_tokens: 5,
						},
					})}`,
					`data: ${JSON.stringify({
						choices: [{ delta: { content: "X".repeat(70) } }],
					})}`,
					"data: [DONE]",
				].join("\n");
				return new Response(`${body}\n`, {
					status: 200,
					headers: { "Content-Type": "text/event-stream" },
				});
			}),
		);
		const result = await testProvider(
			"local",
			{
				baseUrl: "https://provider.example/v1",
				api: "openai-completions",
				apiKey: "k",
				models: [{ id: "model-a" }],
			},
			"model-a",
		);
		expect(result.ok).toBe(true);
		expect(result.text.length).toBeGreaterThanOrEqual(64);
		expect(result.usage).toMatchObject({ promptTokens: 3 });
		vi.unstubAllGlobals();
	});
});
