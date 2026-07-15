// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VioloopConfig } from "../../src/shared/types";
import {
	exportLocalData,
	serializeExport,
} from "../../src/web/shared/storage/export";
import {
	downloadLocalExport,
	importLocalExport,
} from "../../src/web/shared/storage/exportActions";
import { createLocalConversation } from "../../src/web/shared/storage/localData";
import {
	clearAllLocalData,
	markLocalSeedComplete,
	saveConfig,
} from "../../src/web/shared/storage/repository";

const config: VioloopConfig = {
	chat: {
		defaultProvider: "local",
		defaultModel: "model-a",
		systemPrompt: "System",
		compaction: { enabled: false, triggerTokens: 1000, keepRecentTokens: 100 },
	},
	providers: {
		local: {
			baseUrl: "https://provider.example/v1",
			api: "openai-completions",
			apiKey: "secret",
			models: [{ id: "model-a" }],
		},
	},
};

beforeEach(async () => {
	await clearAllLocalData();
	await saveConfig(config);
	await markLocalSeedComplete();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("export and import actions", () => {
	it("downloads a local export through a temporary anchor", async () => {
		await createLocalConversation({
			title: "Export me",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
			allowedTacticIds: [],
			enabledStateIds: [],
		});
		const click = vi.fn();
		const anchor = document.createElement("a");
		anchor.click = click;
		const createElement = vi
			.spyOn(document, "createElement")
			.mockReturnValue(anchor);
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
		const data = await downloadLocalExport();
		expect(data.format).toBe("violoop-export");
		expect(click).toHaveBeenCalled();
		createElement.mockRestore();
	});

	it("imports exports, backs up on replace, and rejects invalid files", async () => {
		await createLocalConversation({
			title: "Import me",
			profile: { assistantName: "A", userRole: "U", assistantRole: "R" },
			capabilities: {
				tactics: false,
				dayProgression: false,
				sessionState: false,
				sceneEvents: false,
			},
			allowedTacticIds: [],
			enabledStateIds: [],
		});
		const exported = await exportLocalData();
		const file = new File([serializeExport(exported)], "violoop.json", {
			type: "application/json",
		});
		const result = await importLocalExport(file, "replace");
		expect(result.replaced + result.imported).toBeGreaterThan(0);
		await expect(
			importLocalExport(
				new File(["{}"], "bad.json", { type: "application/json" }),
			),
		).rejects.toThrow();
		await expect(
			importLocalExport(
				new File([serializeExport(exported)], "big.json", {
					type: "application/json",
				}),
				"replace",
				{
					confirm: async () => false,
				},
			),
		).rejects.toThrow("Import cancelled.");
		const huge = new File([""], "huge.json", { type: "application/json" });
		Object.defineProperty(huge, "size", { value: 21 * 1024 * 1024 });
		await expect(importLocalExport(huge)).rejects.toThrow("too large");
	});
});
