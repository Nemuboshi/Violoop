import { useMemo, useState } from "react";
import {
	type ConversationPayload,
	fetchConversation,
} from "../../../entities/conversation";
import type { ChatUsage, TimelineItem } from "../../../entities/message";
import {
	defaultSessionCapabilities,
	defaultSessionProfile,
	type SessionCapabilities,
	type SessionClock,
	type SessionProfile,
} from "../../../entities/session";
import { createClientId } from "../../../shared/lib";
import { editLastUserMessage, sendChatMessage } from "../api/chatApi";

type ChatSessionStatus = "idle" | "thinking" | "error";

type ChatSessionEffects = {
	onRefreshConversations?: () => Promise<void>;
	onRefreshTactics?: (conversationId?: string | null) => Promise<unknown>;
};

function latestUsage(items: TimelineItem[]) {
	return [...items].reverse().find((message) => message.usage)?.usage ?? null;
}

export function useChatSession() {
	const [messages, setMessages] = useState<TimelineItem[]>([]);
	const [draft, setDraft] = useState("");
	const [status, setStatus] = useState<ChatSessionStatus>("idle");
	const [error, setError] = useState("");
	const [lastUsage, setLastUsage] = useState<ChatUsage | null>(null);
	const [lastTacticIds, setLastTacticIds] = useState<string[]>([]);
	const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
	const [editingDraft, setEditingDraft] = useState("");
	const [activeConversationId, setActiveConversationId] = useState<
		string | null
	>(null);
	const [activeProfile, setActiveProfile] = useState<SessionProfile>(
		defaultSessionProfile,
	);
	const [activeCapabilities, setActiveCapabilities] =
		useState<SessionCapabilities>(defaultSessionCapabilities);
	const [activeClock, setActiveClock] = useState<SessionClock | null>(null);

	const canSend =
		activeConversationId !== null &&
		draft.trim().length > 0 &&
		status !== "thinking";
	const visibleMessages = useMemo(
		() => messages.filter((message) => message.promptVisibility !== "hidden"),
		[messages],
	);
	const lastEditableUserMessage = useMemo(
		() =>
			[...visibleMessages]
				.reverse()
				.find(
					(message) => message.kind === "chat" && message.role === "user",
				) ?? null,
		[visibleMessages],
	);
	const lastEditableUserMessageId =
		status === "thinking" ? null : (lastEditableUserMessage?.id ?? null);

	function resetSession() {
		setActiveConversationId(null);
		setActiveProfile(defaultSessionProfile);
		setActiveCapabilities(defaultSessionCapabilities);
		setActiveClock(null);
		setMessages([]);
		setLastUsage(null);
		setLastTacticIds([]);
		setEditingMessageId(null);
		setEditingDraft("");
		setDraft("");
		setError("");
		setStatus("idle");
	}

	function applyConversation(payload: ConversationPayload) {
		setActiveConversationId(payload.conversation.id);
		setActiveProfile(payload.conversation.profile);
		setActiveCapabilities(payload.conversation.capabilities);
		setActiveClock(payload.clock);
		setMessages(payload.timelineItems);
		setError("");
		setStatus("idle");
		setLastUsage(null);
		setLastTacticIds([]);
		setEditingMessageId(null);
		setEditingDraft("");
	}

	async function refreshConversationTimeline(conversationId: string) {
		const restored = await fetchConversation(conversationId);
		setActiveClock(restored.clock);
		setMessages(restored.timelineItems);
	}

	async function restoreConversation(
		conversationId: string,
		effects: Pick<ChatSessionEffects, "onRefreshTactics"> = {},
	) {
		const restored = await fetchConversation(conversationId);
		setActiveConversationId(conversationId);
		setActiveProfile(restored.conversation.profile);
		setActiveCapabilities(restored.conversation.capabilities);
		setActiveClock(restored.clock);
		setMessages(restored.timelineItems);
		setError("");
		setStatus("idle");
		setLastUsage(latestUsage(restored.timelineItems));
		setLastTacticIds([]);
		setEditingMessageId(null);
		setEditingDraft("");
		await effects.onRefreshTactics?.(conversationId);
	}

	async function applyChatPayload(
		payload: Awaited<ReturnType<typeof sendChatMessage>>,
		fallbackConversationId: string,
		effects: ChatSessionEffects,
	) {
		const conversationId = payload.conversationId ?? fallbackConversationId;
		setLastTacticIds(payload.tacticIds ?? []);
		setLastUsage(payload.usage ?? null);
		if (conversationId) {
			setActiveConversationId(conversationId);
		}
		if (payload.clock) {
			setActiveClock(payload.clock);
		}
		if (payload.timelineItems) {
			setMessages(payload.timelineItems);
		}

		await effects.onRefreshConversations?.();
		await effects.onRefreshTactics?.(conversationId);
		if (payload.createdItems?.some((item) => item.kind === "day_transition")) {
			for (const delay of [1500, 5000, 12000]) {
				window.setTimeout(() => {
					void effects.onRefreshTactics?.(conversationId);
					if (conversationId) {
						void refreshConversationTimeline(conversationId);
					}
				}, delay);
			}
		}
	}

	async function sendMessage(effects: ChatSessionEffects = {}) {
		const content = draft.trim();
		if (!content || status === "thinking") {
			return;
		}

		if (!activeConversationId) {
			setError("Start a new chat before sending a message.");
			return;
		}

		const userMessage: TimelineItem = {
			id: createClientId("message"),
			conversationId: activeConversationId,
			kind: "chat",
			role: "user",
			speakerName: "You",
			content,
			promptVisibility: "visible",
			createdAt: new Date().toISOString(),
		};

		setMessages((current) => [...current, userMessage]);
		setDraft("");
		setStatus("thinking");
		setError("");
		setLastUsage(null);

		try {
			const payload = await sendChatMessage({
				conversationId: activeConversationId,
				message: userMessage.content,
			});
			await applyChatPayload(payload, activeConversationId, effects);
			setStatus("idle");
		} catch (caught) {
			const message =
				caught instanceof Error
					? caught.message
					: "Unable to reach the model provider.";
			setStatus("error");
			setError(message);
			setMessages((current) =>
				current.some((item) => item.role === "assistant" && item.content === "")
					? current.map((item) =>
							item.role === "assistant" && item.content === ""
								? {
										...item,
										content:
											"The request failed before a response was produced.",
									}
								: item,
						)
					: current,
			);
		}
	}

	function startEditingLastUserMessage(messageId: string, content: string) {
		if (messageId !== lastEditableUserMessageId) {
			return;
		}

		setEditingMessageId(messageId);
		setEditingDraft(content);
		setError("");
	}

	async function confirmLastUserMessageEdit(effects: ChatSessionEffects = {}) {
		const content = editingDraft.trim();
		if (!editingMessageId || status === "thinking") {
			return;
		}

		if (!content) {
			setError("A user message is required.");
			return;
		}

		const targetId = editingMessageId;
		const conversationId = activeConversationId as string;
		const previousMessages = messages;
		const targetIndex = messages.findIndex(
			(message) => message.id === targetId,
		);
		setMessages(
			messages
				.slice(0, targetIndex + 1)
				.map((message) =>
					message.id === targetId ? { ...message, content } : message,
				),
		);
		setEditingMessageId(null);
		setEditingDraft("");
		setStatus("thinking");
		setError("");
		setLastUsage(null);

		try {
			const payload = await editLastUserMessage({
				conversationId,
				message: content,
			});
			await applyChatPayload(payload, conversationId, effects);
			setStatus("idle");
		} catch (caught) {
			const message =
				caught instanceof Error
					? caught.message
					: "Unable to reach the model provider.";
			setStatus("error");
			setError(message);
			setMessages(previousMessages);
			setEditingMessageId(targetId);
			setEditingDraft(content);
		}
	}

	return {
		messages,
		draft,
		setDraft,
		status,
		error,
		setError,
		lastUsage,
		lastTacticIds,
		editingMessageId,
		editingDraft,
		setEditingDraft,
		lastEditableUserMessageId,
		activeConversationId,
		activeProfile,
		activeCapabilities,
		activeClock,
		setActiveClock,
		canSend,
		visibleMessages,
		applyConversation,
		resetSession,
		restoreConversation,
		sendMessage,
		startEditingLastUserMessage,
		confirmLastUserMessageEdit,
	};
}
