import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
	vi.unstubAllGlobals();
});

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

		const loopbackIpv6 = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					...provider(),
					baseUrl: "http://[::1]:8787/v1",
				},
				messages: [{ role: "user", content: "Hi" }],
			}),
		});
		expect(loopbackIpv6.status).toBe(200);

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

	it("filters header allowlists, model lists, and denies disallowed provider-test hosts", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n`,
						{ status: 200 },
					),
			),
		);
		const proxied = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://provider.example/v1",
					api: "openai-completions",
					model: { id: "model-a" },
					models: [{ id: "model-a", name: "Named" }],
					headers: {
						Accept: "text/plain",
						Authorization: "nope",
						"X-Trace": "1",
					},
				},
				messages: [
					{ role: "user", content: "hi" },
					{ role: "tool", content: "bad" },
				],
			}),
		});
		expect(proxied.status).toBe(400);
		const ok = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://provider.example/v1",
					api: "openai-completions",
					model: { id: "model-a" },
					models: [{ id: "model-a", name: "Named" }],
					headers: {
						Accept: "text/plain",
						Authorization: "nope",
						"X-Trace": "1",
					},
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(ok.status).toBe(200);

		const testDenied = await workerApp.request(
			"/api/providers/test",
			{
				method: "POST",
				body: JSON.stringify({
					providerId: "p",
					provider: {
						baseUrl: "https://provider.example/v1",
						api: "openai-completions",
					},
					model: "model-a",
				}),
			},
			{ VIOLOOP_ALLOWED_PROVIDER_HOSTS: "other.example" },
		);
		expect(testDenied.status).toBe(400);
	});

	it("rejects malformed message lists, private-network hosts, and empty-message upstream failures", async () => {
		const badMessage = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: provider(),
				messages: [null, { role: "user" }],
			}),
		});
		expect(badMessage.status).toBe(400);

		const privateLink = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: { ...provider(), baseUrl: "https://169.254.10.10/v1" },
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(privateLink.status).toBe(400);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw Object.assign(new Error(""), {
					status: 503,
					detail: "empty-message",
				});
			}),
		);
		const emptyMessage = await workerApp.request("/api/providers/test", {
			method: "POST",
			body: JSON.stringify({
				providerId: "draft-id",
				provider: provider(),
				model: "m",
			}),
		});
		expect(emptyMessage.status).toBe(503);
		expect(await emptyMessage.json()).toMatchObject({
			error: "Unexpected server error",
			detail: "empty-message",
		});
	});

	it("validates chat provider URLs across missing fields, bad hosts, and payload limits", async () => {
		const noProvider = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
		});
		expect(noProvider.status).toBe(400);
		const noModel = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://provider.example/v1",
					api: "openai-completions",
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(noModel.status).toBe(400);
		const badUrl = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "not a url",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(badUrl.status).toBe(400);
		const httpRemote = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "http://provider.example/v1",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(httpRemote.status).toBe(400);
		const internal = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://svc.internal/v1",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(internal.status).toBe(400);
		const zeroHost = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://0.0.0.0/v1",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(zeroHost.status).toBe(400);
		const privateA = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://192.168.1.1/v1",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(privateA.status).toBe(400);
		const privateB = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://172.20.0.1/v1",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(privateB.status).toBe(400);
		const unspecifiedIpv6 = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: { ...provider(), baseUrl: "https://[::]/v1" },
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(unspecifiedIpv6.status).toBe(400);
		const linkLocalIpv6 = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: { ...provider(), baseUrl: "https://[fe80::1]/v1" },
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(linkLocalIpv6.status).toBe(400);
		const uniqueLocalIpv6 = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: { ...provider(), baseUrl: "https://[fd12:3456::1]/v1" },
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(uniqueLocalIpv6.status).toBe(400);
		const ipv4MappedPrivateIpv6 = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					...provider(),
					baseUrl: "https://[::ffff:169.254.1.1]/v1",
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(ipv4MappedPrivateIpv6.status).toBe(400);
		const testLinkLocalIpv6 = await workerApp.request("/api/providers/test", {
			method: "POST",
			body: JSON.stringify({
				providerId: "p",
				provider: { ...provider(), baseUrl: "https://[fe80::1]/v1" },
				model: "model-a",
			}),
		});
		expect(testLinkLocalIpv6.status).toBe(400);
		const hugeBody = "x".repeat(2 * 1024 * 1024 + 10);
		const oversized = await workerApp.request("/api/chat", {
			method: "POST",
			body: hugeBody,
		});
		expect(oversized.status).toBe(413);
		const health = await workerApp.request(
			"/api/health",
			{
				headers: { Origin: "https://app.example" },
			},
			{
				VIOLOOP_ALLOWED_ORIGINS: "https://app.example",
			},
		);
		expect(health.status).toBe(200);
		const testBadUrl = await workerApp.request("/api/providers/test", {
			method: "POST",
			body: JSON.stringify({
				provider: { baseUrl: "::::", api: "openai-completions" },
				model: "m",
			}),
		});
		expect(testBadUrl.status).toBe(400);
		const testEmpty = await workerApp.request("/api/providers/test", {
			method: "POST",
			body: JSON.stringify({
				provider: { baseUrl: "   ", api: "openai-completions" },
				model: "m",
			}),
		});
		expect(testEmpty.status).toBe(400);
	});

	it("accepts a draft provider test and rejects a plain fetch failure with a 500", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({ choices: [{ message: { content: "ok" } }] }),
			),
		);
		const draft = await workerApp.request("/api/providers/test", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://provider.example/v1",
					api: "openai-completions",
					apiKey: "k",
				},
				model: "model-a",
			}),
		});
		expect(draft.status).toBe(200);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("plain-upstream");
			}),
		);
		const plain = await workerApp.request("/api/chat", {
			method: "POST",
			body: JSON.stringify({
				provider: {
					baseUrl: "https://provider.example/v1",
					api: "openai-completions",
					model: { id: "m" },
				},
				messages: [{ role: "user", content: "hi" }],
			}),
		});
		expect(plain.status).toBe(500);
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
