import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		setupFiles: ["tests/web/setup.ts"],
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary"],
			include: [
				"src/shared/**/*.ts",
				"src/server/app.ts",
				"src/server/config.ts",
				"src/server/conversations.ts",
				"src/server/tactics.ts",
				"src/server/runtime.ts",
				"src/server/compaction.ts",
				"src/server/env.ts",
				"src/server/httpErrors.ts",
				"src/server/serverContext.ts",
				"src/server/routes/**/*.ts",
				"src/server/services/**/*.ts",
				"src/server/providers/index.ts",
				"src/server/providers/openaiCompletions.ts",
				"src/web/**/*.ts",
				"src/web/**/*.tsx",
			],
			exclude: ["src/server/index.ts", "src/web/main.tsx"],
			thresholds: {
				lines: 100,
				functions: 100,
				branches: 100,
				statements: 100,
			},
		},
	},
});
