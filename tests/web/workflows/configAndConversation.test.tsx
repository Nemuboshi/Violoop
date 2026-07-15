// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	deleteConversation,
	listConversations,
	renameConversation,
} from "../../../src/web/entities/conversation";
import { useConfigSettingsWorkflow } from "../../../src/web/features/config-settings";
import {
	loadConfig,
	saveConfig,
} from "../../../src/web/features/config-settings/api/configApi";
import { useConversationWorkflow } from "../../../src/web/features/conversation-management";
import { configResponse, conversation, queueMock } from "./helpers";

vi.mock("../../../src/web/entities/conversation", () => ({
	deleteConversation: vi.fn(),
	getConversation: vi.fn(),
	listConversations: vi.fn(),
	renameConversation: vi.fn(),
}));

vi.mock("../../../src/web/features/config-settings/api/configApi", () => ({
	loadConfig: vi.fn(),
	saveConfig: vi.fn(),
}));

beforeEach(() => {
	vi.mocked(deleteConversation).mockReset();
	vi.mocked(listConversations).mockReset();
	vi.mocked(renameConversation).mockReset();
	vi.mocked(loadConfig).mockReset();
	vi.mocked(saveConfig).mockReset();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("web business workflows: config and conversation management", () => {
	it("loads and saves global chat settings through the config workflow", async () => {
		queueMock(vi.mocked(loadConfig), configResponse, configResponse);
		queueMock(vi.mocked(saveConfig), { config: configResponse.config }, () => {
			throw new Error("Save failed");
		});
		const refreshTacticLibrary = vi.fn(async () => []);
		const { result } = renderHook(() =>
			useConfigSettingsWorkflow({ refreshTacticLibrary }),
		);

		await act(async () => {
			await result.current.saveSettingsDraft();
		});
		expect(result.current.error).toBe("");

		await act(async () => {
			await result.current.refreshConfig();
		});
		expect(result.current.draft?.defaultModel).toBe("model-a");

		await act(async () => {
			await result.current.openConfigModal();
		});
		expect(result.current.open).toBe(true);
		expect(refreshTacticLibrary).toHaveBeenCalled();

		const settingsDraft = result.current.draft;
		expect(settingsDraft).not.toBeNull();
		if (!settingsDraft) {
			throw new Error("Expected config draft to be loaded.");
		}

		await act(async () => {
			result.current.setDraft({
				...settingsDraft,
				temperature: "0.5",
			});
		});
		await act(async () => {
			await result.current.saveSettingsDraft();
		});
		expect(result.current.error).toBe("");

		await act(async () => {
			await result.current.saveSettingsDraft();
		});
		expect(result.current.error).toBe("Save failed");
	});

	it("reports unknown config-save failures without leaving the settings workflow saving", async () => {
		queueMock(vi.mocked(loadConfig), configResponse);
		queueMock(vi.mocked(saveConfig), () => {
			throw "offline";
		});
		const { result } = renderHook(() =>
			useConfigSettingsWorkflow({
				refreshTacticLibrary: vi.fn(async () => []),
			}),
		);

		await act(async () => {
			await result.current.refreshConfig();
		});
		await act(async () => {
			await result.current.saveSettingsDraft();
		});
		expect(result.current.error).toBe("Unable to save config.");
		expect(result.current.saving).toBe(false);
	});

	it("keeps conversation deletion bounded and resets the active session only when needed", async () => {
		queueMock(vi.mocked(listConversations), [conversation]);
		queueMock(vi.mocked(deleteConversation), [], [], () => {
			throw new Error("Cannot delete");
		});
		const onError = vi.fn();
		const onDeletedActive = vi.fn();
		const { result } = renderHook(() =>
			useConversationWorkflow({ onError, onDeletedActive }),
		);

		await act(async () => {
			await result.current.confirmDeleteConversation("c1");
		});
		expect(onError).not.toHaveBeenCalled();

		await act(async () => {
			await result.current.refreshConversations();
		});
		expect(result.current.conversations).toHaveLength(1);

		await act(async () => {
			result.current.setConversationToDelete(conversation);
		});
		await act(async () => {
			await result.current.confirmDeleteConversation("c1");
		});
		expect(onDeletedActive).toHaveBeenCalled();
		expect(result.current.conversationToDelete).toBeNull();

		await act(async () => {
			result.current.setConversationToDelete(conversation);
		});
		await act(async () => {
			await result.current.confirmDeleteConversation("other");
		});
		expect(onDeletedActive).toHaveBeenCalledTimes(1);

		await act(async () => {
			result.current.setConversationToDelete(conversation);
		});
		await act(async () => {
			await result.current.confirmDeleteConversation("other");
		});
		expect(onError).toHaveBeenLastCalledWith("Cannot delete");
	});

	it("uses fallback messages when conversation deletion fails outside the normal API envelope", async () => {
		queueMock(vi.mocked(deleteConversation), () => {
			throw "offline";
		});
		const onError = vi.fn();
		const onDeletedActive = vi.fn();
		const { result } = renderHook(() =>
			useConversationWorkflow({ onError, onDeletedActive }),
		);

		act(() => {
			result.current.setConversationToDelete(conversation);
		});
		await act(async () => {
			await result.current.confirmDeleteConversation("other");
		});
		expect(onDeletedActive).not.toHaveBeenCalled();
		expect(onError).toHaveBeenLastCalledWith("Unable to delete conversation.");
	});

	it("renames conversations explicitly and reports rename failures", async () => {
		queueMock(
			vi.mocked(renameConversation),
			[{ ...conversation, title: "Renamed" }],
			() => {
				throw new Error("Rename failed");
			},
			() => {
				throw "offline";
			},
		);
		const onError = vi.fn();
		const { result } = renderHook(() =>
			useConversationWorkflow({ onError, onDeletedActive: vi.fn() }),
		);

		await act(async () => {
			await result.current.confirmRenameConversation();
		});
		expect(onError).not.toHaveBeenCalled();

		act(() => {
			result.current.requestRenameConversation(conversation);
		});
		expect(result.current.conversationToRename?.id).toBe("c1");
		expect(result.current.renameTitle).toBe("Session");

		act(() => {
			result.current.setRenameTitle("Renamed");
		});
		await act(async () => {
			await result.current.confirmRenameConversation();
		});
		expect(result.current.conversations).toEqual([
			{ ...conversation, title: "Renamed" },
		]);
		expect(result.current.conversationToRename).toBeNull();

		act(() => {
			result.current.requestRenameConversation(conversation);
			result.current.setRenameTitle("Broken");
		});
		await act(async () => {
			await result.current.confirmRenameConversation();
		});
		expect(onError).toHaveBeenLastCalledWith("Rename failed");

		act(() => {
			result.current.requestRenameConversation(conversation);
			result.current.setRenameTitle("Offline");
		});
		await act(async () => {
			await result.current.confirmRenameConversation();
		});
		expect(onError).toHaveBeenLastCalledWith("Unable to rename conversation.");
	});
});
