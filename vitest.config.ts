import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		setupFiles: ["tests/web/setup.ts"],
		testTimeout: 15000,
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary"],
			include: [
				"src/shared/**/*.ts",
				"src/providers/index.ts",
				"src/providers/openaiCompletions.ts",
				"src/providers/providerTest.ts",
				"src/worker/**/*.ts",
				"src/web/**/*.ts",
				"src/web/**/*.tsx",
			],
			exclude: ["src/web/main.tsx"],
			thresholds: {
				lines: 100,
				functions: 100,
				branches: 100,
				statements: 100,
			},
		},
	},
});
