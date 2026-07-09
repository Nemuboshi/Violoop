import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

let tempDir = "";

afterEach(async () => {
	delete process.env.VIOLOOP_HOST;
	delete process.env.VIOLOOP_PORT;
	delete process.env.VIOLOOP_CORS_ORIGINS;
	delete process.env.VIOLOOP_CONTEXT_DATA_DIR;
	delete process.env.VIOLOOP_DATA_DIR;
	delete process.env.VIOLOOP_TEST_ENV;
	await rm(tempDir, { recursive: true, force: true });
	tempDir = "";
	vi.resetModules();
});

describe("server environment and paths", () => {
	it("parses deployment env defaults, CSV origins, and invalid ports", async () => {
		const { parseServerEnv } = await import("../../src/server/env");

		expect(parseServerEnv({} as NodeJS.ProcessEnv)).toEqual({
			host: "127.0.0.1",
			port: 3000,
			corsOrigins: ["http://127.0.0.1:5173"],
			dataDir: "data",
		});
		expect(
			parseServerEnv({
				VIOLOOP_HOST: "0.0.0.0",
				VIOLOOP_PORT: "4444",
				VIOLOOP_CORS_ORIGINS: " http://a.test, ,http://b.test ",
				VIOLOOP_DATA_DIR: "custom-data",
			} as NodeJS.ProcessEnv),
		).toEqual({
			host: "0.0.0.0",
			port: 4444,
			corsOrigins: ["http://a.test", "http://b.test"],
			dataDir: "custom-data",
		});
		expect(
			parseServerEnv({
				VIOLOOP_CORS_ORIGINS: " , ",
			} as NodeJS.ProcessEnv).corsOrigins,
		).toEqual(["http://127.0.0.1:5173"]);
		expect(() =>
			parseServerEnv({ VIOLOOP_PORT: "bad" } as NodeJS.ProcessEnv),
		).toThrow();
	});

	it("loads .env files only when they exist", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "violoop-env-test-"));
		const { loadDotEnv } = await import("../../src/server/env");

		loadDotEnv(join(tempDir, "missing.env"));
		expect(process.env.VIOLOOP_TEST_ENV).toBeUndefined();

		const envPath = join(tempDir, ".env");
		await writeFile(envPath, "VIOLOOP_TEST_ENV=loaded\n", "utf8");
		loadDotEnv(envPath);
		expect(process.env.VIOLOOP_TEST_ENV).toBe("loaded");
	});

	it("centralizes data file paths in the configured server context", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "violoop-context-test-"));
		const { parseServerEnv } = await import("../../src/server/env");
		const { configureServerContext, getServerContext, getServerPaths } =
			await import("../../src/server/serverContext");

		const context = configureServerContext(
			parseServerEnv({
				VIOLOOP_HOST: "0.0.0.0",
				VIOLOOP_PORT: "4444",
				VIOLOOP_DATA_DIR: tempDir,
			} as NodeJS.ProcessEnv),
		);

		expect(context).toMatchObject({
			host: "0.0.0.0",
			port: 4444,
			dataDir: resolve(tempDir),
		});
		expect(getServerContext()).toBe(context);
		expect(getServerPaths()).toEqual({
			dataDir: resolve(tempDir),
			settingsPath: resolve(tempDir, "settings.json"),
			tacticsPath: resolve(tempDir, "tactics.json"),
			stateDefinitionsPath: resolve(tempDir, "states.json"),
			conversationLogPath: resolve(tempDir, "conversations.jsonl"),
		});
	});

	it("can lazily initialize paths from process env for non-bootstrap tests", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "violoop-context-lazy-test-"));
		process.env.VIOLOOP_DATA_DIR = tempDir;
		vi.resetModules();
		const { getServerPaths } = await import("../../src/server/serverContext");

		expect(getServerPaths().settingsPath).toBe(
			resolve(tempDir, "settings.json"),
		);
	});

	it("uses deployment env for the Vite API proxy target", async () => {
		process.env.VIOLOOP_HOST = "0.0.0.0";
		process.env.VIOLOOP_PORT = "4321";
		const viteConfig = (await import("../../vite.config")).default;

		const config =
			typeof viteConfig === "function"
				? await viteConfig({ mode: "test", command: "serve" } as never)
				: viteConfig;
		expect(config.server?.proxy).toMatchObject({
			"/api": "http://0.0.0.0:4321",
		});

		process.env.VIOLOOP_PORT = "bad";
		expect(() =>
			typeof viteConfig === "function"
				? viteConfig({ mode: "test", command: "serve" } as never)
				: viteConfig,
		).toThrow("VIOLOOP_PORT");
	});
});
