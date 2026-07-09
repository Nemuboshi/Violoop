import { useState } from "react";
import {
	type ConversationSummary,
	deleteConversation,
	fetchConversations,
	renameConversation,
} from "../../../entities/conversation";

type UseConversationWorkflowOptions = {
	onError: (message: string) => void;
	onDeletedActive: () => void;
};

export function useConversationWorkflow(
	options: UseConversationWorkflowOptions,
) {
	const [conversations, setConversations] = useState<ConversationSummary[]>([]);
	const [conversationToDelete, setConversationToDelete] =
		useState<ConversationSummary | null>(null);
	const [conversationToRename, setConversationToRename] =
		useState<ConversationSummary | null>(null);
	const [renameTitle, setRenameTitle] = useState("");
	const [deletingConversation, setDeletingConversation] = useState(false);
	const [renamingConversation, setRenamingConversation] = useState(false);

	async function refreshConversations() {
		setConversations(await fetchConversations());
	}

	async function confirmDeleteConversation(
		activeConversationId: string | null,
	) {
		if (!conversationToDelete) {
			return;
		}

		setDeletingConversation(true);
		options.onError("");

		try {
			const nextConversations = await deleteConversation(
				conversationToDelete.id,
			);
			setConversations(nextConversations);
			if (activeConversationId === conversationToDelete.id) {
				options.onDeletedActive();
			}
			setConversationToDelete(null);
		} catch (caught) {
			options.onError(
				caught instanceof Error
					? caught.message
					: "Unable to delete conversation.",
			);
		} finally {
			setDeletingConversation(false);
		}
	}

	function requestRenameConversation(conversation: ConversationSummary) {
		setConversationToRename(conversation);
		setRenameTitle(conversation.title);
	}

	async function confirmRenameConversation() {
		if (!conversationToRename) {
			return;
		}

		setRenamingConversation(true);
		options.onError("");

		try {
			const nextConversations = await renameConversation(
				conversationToRename.id,
				{ title: renameTitle },
			);
			setConversations(nextConversations);
			setConversationToRename(null);
		} catch (caught) {
			options.onError(
				caught instanceof Error
					? caught.message
					: "Unable to rename conversation.",
			);
		} finally {
			setRenamingConversation(false);
		}
	}

	return {
		conversations,
		conversationToDelete,
		conversationToRename,
		deletingConversation,
		renamingConversation,
		renameTitle,
		setRenameTitle,
		setConversationToDelete,
		setConversationToRename,
		refreshConversations,
		confirmDeleteConversation,
		confirmRenameConversation,
		requestRenameConversation,
	};
}
