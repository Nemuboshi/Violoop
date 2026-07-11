import { describe, expect, it, vi } from "vitest";
import { workerApp } from "../src/worker/app";

function provider() {
	return {
		id: "test",
		baseUrl: "https://provider.example/v1",
		api: "openai-completions" as const,
		model: { id: "model-a" },
	};
}
function sse(text: string) {
	return new Response(
		`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n`,
		{ status: 200, headers: { "Content-Type": "text/event-stream" } },
	);
}

describe("Hono Worker proxy", () => {
	it("serves health and proxies stateless chat", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => sse("hello")),
		);
		const health = await workerApp.request("/api/health");
		expect(health.status).toBe(200);
		expect(await health.json()).toEqual({ ok: true });
		const response = await workerApp.request("/api/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				provider: provider(),
				messages: [{ role: "user", content: "Hi" }],
				promptBlocks: [],
			}),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ text: "hello" });
		vi.unstubAllGlobals();
	});

	it("rejects malformed payloads, unsafe URLs, and unsupported APIs", async () => {
		const malformed = await workerApp.request("/api/chat", {
			method: "POST",
			body: "bad",
		});
		expect(malformed.status).toBe(400);
		const unsafe = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: { ...provider(), baseUrl: "http://169.254.169.254" },
				messages: [],
			}),
		});
		expect(unsafe.status).toBe(400);
		const unsupported = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: { ...provider(), api: "other" },
				messages: [],
			}),
		});
		expect(unsupported.status).toBe(400);
		const missingMessages = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({ provider: provider() }),
		});
		expect(missingMessages.status).toBe(400);
	});

	it("validates provider test input and handles an upstream failure", async () => {
		const missing = await workerApp.request("/api/providers/test", {
			method: "POST",
			body: JSON.stringify({}),
		});
		expect(missing.status).toBe(400);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("no", { status: 401 })),
		);
		const response = await workerApp.request("/api/providers/test", {
			method: "POST",
			body: JSON.stringify({
				providerId: "p",
				provider: provider(),
				model: "model-a",
			}),
		});
		expect(response.status).toBe(401);
		vi.unstubAllGlobals();
	});
});
