import type { KeyboardEvent } from "react";
import { useEffect } from "react";
import {
	formatCacheHit,
	formatToken,
	timelineContentClassName,
	timelineItemClassName,
	timelineSpeaker,
	timelineSpeakerClassName,
} from "../../../entities/message";
import { defaultSessionCapabilities } from "../../../entities/session";
import { useChatSession } from "../../../features/chat-session";
import {
	isThinkingLevel,
	thinkingLevelOptions,
	useConfigSettingsWorkflow,
} from "../../../features/config-settings";
import { useConversationWorkflow } from "../../../features/conversation-management";
import { useNewChatWorkflow } from "../../../features/new-chat";
import {
	activeModelOptions,
	providerEntries,
	useProviderWorkflow,
} from "../../../features/provider-management";
import {
	useTacticEditorWorkflow,
	useTacticsWorkflow,
} from "../../../features/tactic-management";
import type { ChatTimelineItemView } from "../../../widgets/chat-panel";
import type {
	ConfigModalView,
	ConfigSettingsFormDraft,
} from "../../../widgets/config-modal";
import type { SidebarView } from "../../../widgets/sidebar";

export function useChatPage() {
	const chatSession = useChatSession();
	const tactics = useTacticsWorkflow();

	async function refreshSessionTactics(conversationId?: string | null) {
		const status = await tactics.refreshSessionStatus(conversationId);
		if (status?.clock) {
			chatSession.setActiveClock(status.clock);
		}
		return status;
	}

	const conversations = useConversationWorkflow({
		onError: chatSession.setError,
		onDeletedActive: () => {
			chatSession.resetSession();
			tactics.clearSessionStatus();
		},
	});
	const configSettings = useConfigSettingsWorkflow({
		refreshTacticLibrary: tactics.refreshLibrary,
	});
	const providers = useProviderWorkflow({
		config: configSettings.config,
		saveAppConfig: configSettings.saveAppConfig,
		setConfigError: configSettings.setError,
		setConfigSaving: configSettings.setSaving,
	});
	const config = {
		...configSettings,
		...providers,
	};
	const tacticEditor = useTacticEditorWorkflow({
		activeConversationId: chatSession.activeConversationId,
		refreshTacticLibrary: tactics.refreshLibrary,
		refreshSessionTactics,
		setConfigError: config.setError,
	});
	const newChat = useNewChatWorkflow({
		refreshTacticLibraryStatus: tactics.refreshLibraryStatus,
		onConversationCreated: chatSession.applyConversation,
		onRefreshConversations: conversations.refreshConversations,
		onRefreshTactics: refreshSessionTactics,
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: initial app load should run once.
	useEffect(() => {
		void config.refreshConfig();
		void conversations.refreshConversations();
	}, []);

	function sendMessage() {
		void chatSession.sendMessage({
			onRefreshConversations: conversations.refreshConversations,
			onRefreshTactics: refreshSessionTactics,
		});
	}

	function confirmLastUserMessageEdit() {
		void chatSession.confirmLastUserMessageEdit({
			onRefreshConversations: conversations.refreshConversations,
			onRefreshTactics: refreshSessionTactics,
		});
	}

	function restoreConversation(conversationId: string) {
		void chatSession.restoreConversation(conversationId, {
			onRefreshTactics: refreshSessionTactics,
		});
	}

	function confirmDeleteConversation() {
		void conversations.confirmDeleteConversation(
			chatSession.activeConversationId,
		);
	}

	function requestDeleteConversation(conversationId: string) {
		const conversation = conversations.conversations.find(
			(item) => item.id === conversationId,
		);
		if (conversation) {
			conversations.setConversationToDelete(conversation);
		}
	}

	function requestRenameConversation(conversationId: string) {
		const conversation = conversations.conversations.find(
			(item) => item.id === conversationId,
		);
		if (conversation) {
			conversations.requestRenameConversation(conversation);
		}
	}

	function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
		}
	}

	const configModalView: ConfigModalView = {
		modelOptions: config.config ? activeModelOptions(config.config.config) : [],
		thinkingLevelOptions,
		activeModelLabel: `Active model${
			config.config?.config.providers[config.config.config.chat.defaultProvider]
				?.name
				? ` (${
						config.config.config.providers[
							config.config.config.chat.defaultProvider
						].name
					})`
				: ""
		}`,
		providers: config.config
			? providerEntries(config.config.config).map(([providerId, provider]) => ({
					id: providerId,
					name: provider.name ?? providerId,
					baseUrl: provider.baseUrl,
					modelsLabel:
						provider.models?.map((model) => model.id).join(", ") ||
						"No models configured",
					active: providerId === config.config?.config.chat.defaultProvider,
				}))
			: null,
		tactics: tactics.libraryTactics.map((tactic) => ({
			id: tactic.id,
			name: tactic.name,
			keywordsLabel:
				tactic.keywords.length > 0
					? tactic.keywords.join(", ")
					: "No trigger keywords",
		})),
		states: tactics.stateDefinitions.map((state) => ({
			id: state.id,
			name: state.name,
			description: state.description ?? "",
			defaultValue: state.defaultValue,
		})),
	};

	const chatTimelineItems: ChatTimelineItemView[] =
		chatSession.visibleMessages.map((message) => ({
			id: message.id,
			itemClassName: timelineItemClassName(message),
			speakerClassName: timelineSpeakerClassName(message),
			speaker: timelineSpeaker(message, chatSession.activeProfile),
			contentClassName: timelineContentClassName(message),
			content: message.content,
			editable: message.id === chatSession.lastEditableUserMessageId,
			editing: message.id === chatSession.editingMessageId,
			editValue:
				message.id === chatSession.editingMessageId
					? chatSession.editingDraft
					: undefined,
		}));

	const tacticNameById = new Map(
		(tactics.tacticsStatus?.tactics ?? []).map((tactic) => [
			tactic.id,
			tactic.name,
		]),
	);
	const hasActiveConversation = chatSession.activeConversationId !== null;
	const activeCapabilities =
		chatSession.activeCapabilities ?? defaultSessionCapabilities;
	const sidebarView: SidebarView = {
		conversations: conversations.conversations.map((conversation) => ({
			id: conversation.id,
			title: conversation.title,
			active: conversation.id === chatSession.activeConversationId,
		})),
		provider: hasActiveConversation
			? {
					modelLabel: config.config?.model ?? "loading",
					baseUrlLabel: config.config?.baseUrl ?? "local API proxy",
					cacheLabel: `${
						config.config?.cache?.usageInStreaming
							? "Usage tracking on"
							: "Usage tracking off"
					}${config.config?.cache?.systemPrompt ? " / stable prompt" : ""}`,
					usage: chatSession.lastUsage
						? {
								cacheHitLabel: formatCacheHit(chatSession.lastUsage),
								promptLabel: formatToken(chatSession.lastUsage.promptTokens),
								cachedLabel: formatToken(
									chatSession.lastUsage.cachedPromptTokens,
								),
								completionLabel: formatToken(
									chatSession.lastUsage.completionTokens,
								),
							}
						: null,
				}
			: null,
		tactics: hasActiveConversation
			? {
					day: activeCapabilities.dayProgression
						? (chatSession.activeClock?.day ?? null)
						: null,
					lastLoaded: chatSession.lastTacticIds.map((id) => ({
						id,
						name: tacticNameById.get(id) ?? id,
					})),
					allowed: activeCapabilities.tactics
						? (tactics.tacticsStatus?.tactics ?? [])
								.filter((tactic) =>
									tactics.selectedTacticIds.includes(tactic.id),
								)
								.map((tactic) => ({ id: tactic.id, name: tactic.name }))
						: [],
					userState: activeCapabilities.sessionState
						? (tactics.tacticsStatus?.userState.map((state) => ({
								key: state.key,
								value: state.value,
							})) ?? [])
						: [],
				}
			: null,
	};

	function updateConfigSettingsDraft(draft: ConfigSettingsFormDraft) {
		if (!isThinkingLevel(draft.thinkingLevel)) {
			return;
		}

		config.setDraft({ ...draft, thinkingLevel: draft.thinkingLevel });
	}

	function openTacticEditor(tacticId: string) {
		const tactic = tactics.libraryTactics.find((item) => item.id === tacticId);
		if (tactic) {
			tacticEditor.openTacticEditor(tactic);
		}
	}

	return {
		chatSession,
		chatTimelineItems,
		config,
		configModalView,
		conversations,
		newChat,
		tacticEditor,
		tactics,
		sendMessage,
		confirmLastUserMessageEdit,
		restoreConversation,
		confirmDeleteConversation,
		requestDeleteConversation,
		requestRenameConversation,
		handleComposerKeyDown,
		openTacticEditor,
		sidebarView,
		updateConfigSettingsDraft,
	};
}
