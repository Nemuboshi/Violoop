// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarContent } from "../../../src/web/widgets/sidebar";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("web components", () => {
	it("renders sidebar session actions and hides session-only panels when no chat is active", async () => {
		const user = userEvent.setup();
		const onConfigure = vi.fn();
		const onDelete = vi.fn();
		const onNew = vi.fn();
		const onRename = vi.fn();
		const onRestore = vi.fn();

		const { rerender } = render(
			<SidebarContent
				view={{
					conversations: [],
					provider: null,
					tactics: null,
				}}
				onConfigure={onConfigure}
				onDeleteConversation={onDelete}
				onNewChat={onNew}
				onRenameConversation={onRename}
				onRestoreConversation={onRestore}
			/>,
		);

		expect(screen.getByText("No saved chats yet")).toBeInTheDocument();
		expect(screen.queryByText("Provider")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "New chat" }));
		await user.click(screen.getByRole("button", { name: "Configure" }));
		expect(onNew).toHaveBeenCalled();
		expect(onConfigure).toHaveBeenCalled();

		rerender(
			<SidebarContent
				view={{
					conversations: [
						{ id: "c1", title: "Morning", active: true },
						{ id: "c2", title: "Evening", active: false },
					],
					provider: {
						modelLabel: "model-a",
						baseUrlLabel: "http://provider.test",
						cacheLabel: "Usage tracking on / stable prompt",
						usage: {
							cacheHitLabel: "cache 50%",
							promptLabel: "100",
							cachedLabel: "50",
							completionLabel: "20",
						},
					},
					tactics: {
						day: 2,
						lastLoaded: [{ id: "calm", name: "Calm" }],
						allowed: [{ id: "brief", name: "Brief" }],
						userState: [{ key: "urgency", value: 40 }],
					},
				}}
				onConfigure={onConfigure}
				onDeleteConversation={onDelete}
				onNewChat={onNew}
				onRenameConversation={onRename}
				onRestoreConversation={onRestore}
			/>,
		);

		await user.click(screen.getByRole("button", { name: "Morning" }));
		await user.click(screen.getByRole("button", { name: "Rename Morning" }));
		await user.click(screen.getByRole("button", { name: "Delete Morning" }));
		expect(onRestore).toHaveBeenCalledWith("c1");
		expect(onRename).toHaveBeenCalledWith("c1");
		expect(onDelete).toHaveBeenCalledWith("c1");
		expect(screen.getByText("model-a")).toBeInTheDocument();
		expect(screen.getByText("Day 2")).toBeInTheDocument();
		expect(screen.getByText("Triggered last turn")).toBeInTheDocument();
		expect(screen.getByText("Enabled for session")).toBeInTheDocument();
		expect(screen.getByText("Calm")).toBeInTheDocument();
		expect(screen.getByText("Brief")).toBeInTheDocument();

		rerender(
			<SidebarContent
				view={{
					conversations: [{ id: "c1", title: "Morning", active: false }],
					provider: {
						modelLabel: "model-a",
						baseUrlLabel: "http://provider.test",
						cacheLabel: "Usage tracking off",
						usage: null,
					},
					tactics: {
						day: null,
						lastLoaded: [],
						allowed: [],
						userState: [],
					},
				}}
				onConfigure={onConfigure}
				onDeleteConversation={onDelete}
				onNewChat={onNew}
				onRenameConversation={onRename}
				onRestoreConversation={onRestore}
			/>,
		);
		expect(screen.queryByText("Day 2")).not.toBeInTheDocument();
		expect(
			screen.getByText("No tactic triggered in the last assistant turn"),
		).toBeInTheDocument();
		expect(
			screen.getByText("No tactics enabled for this session"),
		).toBeInTheDocument();
	});
});
