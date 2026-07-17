// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActiveProvider } from "../../src/shared/types";
import {
	requestAgent,
	testAgentProvider,
} from "../../src/web/shared/api/agentTransport";

function provider(overrides: Partial<ActiveProvider> = {}): ActiveProvider {
	return {
		id: "home",
		name: "Home",
		baseUrl: "https://provider.test/v1",
		api: "openai-completions",
		model: { id: "model-a" },
		apiKey: "secret",
		authHeader: true,
		headers: {},
		compat: {},
		...overrides,
	};
}

function request(overrides: Partial<ActiveProvider> = {}) {
	return {
		provider: provider(overrides),
		messages: [{ role: "user" as const, content: "Hi" }],
		promptBlocks: [],
	};
}

function sse(text: string) {
	return new Response(
		`data: {"choices":[{"delta":{"content":"${text}"}}]}\n\ndata: [DONE]`,
		{ status: 200 },
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("agent transport", () => {
	it("uses the Worker proxy by default", async () => {
		const fetchMock = vi.fn(async () => Response.json({ text: "worker" }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(requestAgent(request())).resolves.toEqual({ text: "worker" });
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/chat",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("sends a browser request directly for the browser route", async () => {
		const fetchMock = vi.fn(async () => sse("browser"));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			requestAgent(request({ transport: "browser" })),
		).resolves.toEqual({ text: "browser", usage: undefined });
		expect(fetchMock).toHaveBeenCalledWith(
			"https://provider.test/v1/chat/completions",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("retries through the other route in each fallback order", async () => {
		const browserFirst = vi
			.fn()
			.mockRejectedValueOnce(new TypeError("CORS blocked"))
			.mockResolvedValueOnce(Response.json({ text: "worker" }));
		vi.stubGlobal("fetch", browserFirst);
		await expect(
			requestAgent(request({ transport: "browser-fallback-worker" })),
		).resolves.toEqual({ text: "worker" });
		expect(browserFirst.mock.calls.map(([url]) => url)).toEqual([
			"https://provider.test/v1/chat/completions",
			"/api/chat",
		]);

		const workerFirst = vi
			.fn()
			.mockResolvedValueOnce(new Response("blocked", { status: 502 }))
			.mockResolvedValueOnce(sse("browser"));
		vi.stubGlobal("fetch", workerFirst);
		await expect(
			requestAgent(request({ transport: "worker-fallback-browser" })),
		).resolves.toEqual({ text: "browser", usage: undefined });
		expect(workerFirst.mock.calls.map(([url]) => url)).toEqual([
			"/api/chat",
			"https://provider.test/v1/chat/completions",
		]);
	});

	it("returns the preferred-route failure when every route fails", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("unavailable");
			}),
		);
		await expect(
			requestAgent(request({ transport: "browser-fallback-worker" })),
		).rejects.toThrow("likely blocked by CORS");
	});

	it("explains browser-direct CORS and network failures", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Load failed");
			}),
		);

		await expect(
			testAgentProvider({
				providerId: "home",
				provider: provider({ transport: "browser" }),
				model: "model-a",
			}),
		).rejects.toThrow(
			"Allow this app origin plus the Authorization and Content-Type headers",
		);
	});

	it("tests Worker providers through the validated Worker route", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({ ok: true, provider: "home", model: "model-a" }),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			testAgentProvider({
				providerId: "home",
				provider: provider(),
				model: "model-a",
			}),
		).resolves.toMatchObject({ ok: true });
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/providers/test",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("tests browser providers directly and falls back to the Worker", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new TypeError("CORS blocked"))
			.mockResolvedValueOnce(
				Response.json({ ok: true, provider: "home", model: "model-a" }),
			);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			testAgentProvider({
				providerId: "home",
				provider: provider({ transport: "browser-fallback-worker" }),
				model: "model-a",
			}),
		).resolves.toMatchObject({ ok: true });
		expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
			"https://provider.test/v1/chat/completions",
			"/api/providers/test",
		]);
	});
});
