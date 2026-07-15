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

	it("enforces host allowlists, localhost dev URLs, payload limits, and asset fallback", async () => {
		const allowedOnly = await workerApp.request(
			"/api/chat",
			{
				method: "POST",
				body: JSON.stringify({
					provider: provider(),
					messages: [{ role: "user", content: "Hi" }],
				}),
			},
			{ VIOLOOP_ALLOWED_PROVIDER_HOSTS: "other.example" },
		);
		expect(allowedOnly.status).toBe(400);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => sse("local")),
		);
		const localhost = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					...provider(),
					baseUrl: "http://localhost:8787/v1",
				},
				messages: [{ role: "user", content: "Hi" }],
			}),
		});
		expect(localhost.status).toBe(200);

		const oversized = await workerApp.request("/api/chat", {
			method: "POST",
			headers: { "content-length": String(3 * 1024 * 1024) },
			body: JSON.stringify({ provider: provider(), messages: [] }),
		});
		expect(oversized.status).toBe(413);

		const assets = await workerApp.request(
			"/missing",
			{},
			{
				ASSETS: {
					fetch: async () => new Response("spa", { status: 200 }),
				},
			},
		);
		expect(await assets.text()).toBe("spa");

		const missingAssets = await workerApp.request("/missing");
		expect(missingAssets.status).toBe(404);

		const insecure = await workerApp.request("/api/providers/test", {
			method: "POST",
			body: JSON.stringify({
				providerId: "p",
				provider: { ...provider(), baseUrl: "http://provider.example/v1" },
				model: "model-a",
			}),
		});
		expect(insecure.status).toBe(400);

		const credentialUrl = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					...provider(),
					baseUrl: "https://user:pass@provider.example/v1",
				},
				messages: [{ role: "user", content: "Hi" }],
			}),
		});
		expect(credentialUrl.status).toBe(400);

		const invalidHost = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: { ...provider(), baseUrl: "https://10.0.0.1/v1" },
				messages: [{ role: "user", content: "Hi" }],
			}),
		});
		expect(invalidHost.status).toBe(400);
		vi.unstubAllGlobals();
	});

	it("returns usage from provider streams and successful provider tests", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						[
							`data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}`,
							`data: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 1 } })}`,
							"data: [DONE]",
						].join("\n"),
						{
							status: 200,
							headers: { "Content-Type": "text/event-stream" },
						},
					),
			),
		);
		const chat = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: provider(),
				messages: [{ role: "user", content: "Hi" }],
			}),
		});
		expect(chat.status).toBe(200);
		expect(await chat.json()).toMatchObject({
			text: "hi",
			usage: expect.objectContaining({ promptTokens: 3 }),
		});

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => sse("ok")),
		);
		const test = await workerApp.request("/api/providers/test", {
			method: "POST",
			body: JSON.stringify({
				providerId: "p",
				provider: provider(),
				model: "model-a",
			}),
		});
		expect(test.status).toBe(200);
		vi.unstubAllGlobals();
	});
});
