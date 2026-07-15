import { Popover } from "@base-ui/react/popover";
import { useEffect, useRef, useState } from "react";
import {
	DeleteConversationModal,
	RenameConversationModal,
} from "../../../features/conversation-management";
import { NewChatModal } from "../../../features/new-chat";
import { ProviderEditModal } from "../../../features/provider-management";
import { TacticEditModal } from "../../../features/tactic-management";
import {
	confirmReplaceImportPreview,
	downloadLocalExport,
	type ImportConflictStrategy,
	importLocalExport,
} from "../../../shared/storage";
import { buttonClassName, ScrollArea } from "../../../shared/ui";
import { ChatComposer, ChatTimeline } from "../../../widgets/chat-panel";
import { ConfigModal } from "../../../widgets/config-modal";
import { SidebarContent } from "../../../widgets/sidebar";
import { useChatPage } from "../model/useChatPage";

export default function ChatPage() {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	const [importStrategy, setImportStrategy] =
		useState<ImportConflictStrategy>("replace");
	const [dataActionMessage, setDataActionMessage] = useState("");
	const page = useChatPage();
	const {
		chatSession,
		config,
		configModalView,
		conversations,
		newChat,
		tacticEditor,
		tactics,
	} = page;

	// biome-ignore lint/correctness/useExhaustiveDependencies: this effect intentionally runs after the message list changes.
	useEffect(() => {
		scrollRef.current?.scrollTo({
			top: scrollRef.current.scrollHeight,
			behavior: "smooth",
		});
	}, [chatSession.messages]);

	function renderSidebarContent(className = "", closeOnAction = false) {
		const runAction = (action: () => void) => {
			if (closeOnAction) {
				setMobileMenuOpen(false);
			}
			action();
		};

		return (
			<SidebarContent
				className={className}
				view={page.sidebarView}
				onConfigure={() => runAction(() => void config.openConfigModal())}
				onDeleteConversation={(conversationId) =>
					runAction(() => page.requestDeleteConversation(conversationId))
				}
				onNewChat={() => runAction(() => void newChat.openNewChatModal())}
				onRenameConversation={(conversationId) =>
					runAction(() => page.requestRenameConversation(conversationId))
				}
				onRestoreConversation={(conversationId) =>
					runAction(() => page.restoreConversation(conversationId))
				}
			/>
		);
	}

	return (
		<main className="h-dvh overflow-hidden bg-canvas text-ink">
			<div className="mx-auto grid h-dvh w-full max-w-[1180px] grid-cols-[280px_minmax(0,1fr)] border-x border-line-soft bg-surface max-md:grid-cols-1 max-md:border-x-0">
				<aside className="min-h-0 border-r border-line-soft bg-panel max-md:hidden">
					<ScrollArea className="h-full" contentClassName="min-h-full">
						{renderSidebarContent("p-6")}
					</ScrollArea>
				</aside>

				<section
					className="relative grid min-h-0 grid-rows-[1fr_auto_auto] p-5 max-md:h-dvh max-md:p-3 max-md:pt-14"
					aria-label="Chat messages"
				>
					<Popover.Root open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
						<Popover.Trigger
							aria-label="Open menu"
							className={`${buttonClassName} absolute right-3 top-3 z-30 hidden !h-8 !w-8 !px-0 max-md:flex`}
						>
							<span className="grid w-4 gap-1" aria-hidden="true">
								<span className="h-px bg-neutral-950" />
								<span className="h-px bg-neutral-950" />
								<span className="h-px bg-neutral-950" />
							</span>
						</Popover.Trigger>
						<Popover.Portal>
							<Popover.Positioner
								align="end"
								className="z-[80] outline-none max-md:block md:hidden"
								side="bottom"
								sideOffset={4}
							>
								<Popover.Popup className="w-[min(320px,calc(100vw-1.5rem))] border border-neutral-950 bg-white text-neutral-950 shadow-[0.25rem_0.25rem_0] shadow-black/12 outline-none">
									<ScrollArea
										className="h-[min(560px,calc(100dvh-5rem))]"
										contentClassName="p-4"
									>
										{renderSidebarContent("", true)}
									</ScrollArea>
								</Popover.Popup>
							</Popover.Positioner>
						</Popover.Portal>
					</Popover.Root>
					<ChatTimeline
						items={page.chatTimelineItems}
						scrollRef={scrollRef}
						status={chatSession.status}
						onEditStart={(item) =>
							chatSession.startEditingLastUserMessage(item.id, item.content)
						}
						onEditChange={chatSession.setEditingDraft}
						onEditDone={page.confirmLastUserMessageEdit}
					/>

					{chatSession.error ? (
						<p className="mb-3 border-l-4 border-danger bg-danger-surface px-3 py-2 text-danger">
							{chatSession.error}
						</p>
					) : null}

					<ChatComposer
						activeConversationId={chatSession.activeConversationId}
						assistantName={chatSession.activeProfile.assistantName}
						canSend={chatSession.canSend}
						draft={chatSession.draft}
						status={chatSession.status}
						onDraftChange={chatSession.setDraft}
						onKeyDown={page.handleComposerKeyDown}
						onSubmit={page.sendMessage}
					/>
				</section>
			</div>

			<ConfigModal
				view={configModalView}
				draft={config.draft}
				error={config.error}
				statusMessage={dataActionMessage}
				open={config.open}
				saving={config.saving}
				onDeleteProvider={(providerId) => {
					if (!window.confirm(`Delete provider "${providerId}"?`)) return;
					void config.deleteProvider(providerId);
				}}
				onDeleteState={(stateId) => {
					if (!window.confirm(`Delete state "${stateId}"?`)) return;
					void tacticEditor.deleteStateDefinition(stateId);
				}}
				onOpenChange={config.setOpen}
				importStrategy={importStrategy}
				onImportStrategy={setImportStrategy}
				onExport={() =>
					void downloadLocalExport()
						.then(() => setDataActionMessage("Local data exported."))
						.catch((error) =>
							setDataActionMessage(
								error instanceof Error ? error.message : "Export failed.",
							),
						)
				}
				onImport={(file, strategy) =>
					void importLocalExport(
						file,
						strategy,
						strategy === "replace"
							? { confirm: confirmReplaceImportPreview }
							: {},
					)
						.then(async (result) => {
							await Promise.all([
								config.refreshConfig(),
								conversations.refreshConversations(),
								tactics.refreshLibraryStatus(),
							]);
							setDataActionMessage(
								`Imported ${result.imported} records; skipped ${result.skipped}; replaced ${result.replaced}.`,
							);
						})
						.catch((error) =>
							setDataActionMessage(
								error instanceof Error ? error.message : "Import failed.",
							),
						)
				}
				onSaveState={(state, originalId) =>
					void tacticEditor.saveStateDefinitionDraft(state, originalId)
				}
				onSubmit={config.saveSettingsDraft}
				onDeleteTactic={(tacticId) => {
					if (!window.confirm(`Delete tactic "${tacticId}"?`)) return;
					void tacticEditor.deleteTactic(tacticId);
				}}
				onEditTactic={page.openTacticEditor}
				onNewTactic={tacticEditor.openNewTacticEditor}
				onEditProvider={config.openProviderEditor}
				onNewProvider={config.openNewProviderEditor}
				onUpdate={page.updateConfigSettingsDraft}
				onUseProvider={(providerId) => void config.activateProvider(providerId)}
			/>
			<ProviderEditModal
				draft={config.providerDraft}
				error={config.error}
				open={config.providerDraft !== null}
				saving={config.saving}
				testOpen={config.providerTestOpen}
				testResult={config.providerTestResult}
				testing={config.testingProvider}
				onChange={config.setProviderDraft}
				onTestOpenChange={config.setProviderTestOpen}
				onOpenChange={config.closeProviderEditor}
				onSave={(draft) => void config.saveProviderDraft(draft)}
				onTest={(draft) => void config.testProviderDraft(draft)}
			/>
			<TacticEditModal
				draft={tacticEditor.tacticDraft}
				error={config.error}
				open={tacticEditor.tacticDraft !== null}
				saving={tacticEditor.savingTactic}
				stateDefinitions={tactics.stateDefinitions}
				onChange={tacticEditor.setTacticDraft}
				onOpenChange={() => tacticEditor.setTacticDraft(null)}
				onSave={(draft) => void tacticEditor.saveTacticDraft(draft)}
			/>
			<NewChatModal
				open={newChat.open}
				draft={newChat.draft}
				error={newChat.error}
				saving={newChat.saving}
				stateDefinitions={newChat.stateDefinitions}
				selectedTacticIds={newChat.selectedTacticIds}
				selectedStateIds={newChat.selectedStateIds}
				tactics={tactics.libraryTactics}
				onDraftChange={newChat.setDraft}
				onOpenChange={newChat.setOpen}
				onStart={() => void newChat.startNewConversation()}
				onStateToggle={newChat.setStateEnabled}
				onToggle={newChat.setTacticAllowed}
			/>
			<DeleteConversationModal
				conversation={conversations.conversationToDelete}
				deleting={conversations.deletingConversation}
				onCancel={() => conversations.setConversationToDelete(null)}
				onConfirm={page.confirmDeleteConversation}
			/>
			<RenameConversationModal
				conversation={conversations.conversationToRename}
				renaming={conversations.renamingConversation}
				title={conversations.renameTitle}
				onCancel={() => conversations.setConversationToRename(null)}
				onConfirm={() => void conversations.confirmRenameConversation()}
				onTitleChange={conversations.setRenameTitle}
			/>
		</main>
	);
}
