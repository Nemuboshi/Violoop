import type {
	ConversationPayload,
	ConversationSummary,
	RenameConversationRequest,
} from "../../../../shared/types";
import {
	getLocalConversationPayload,
	listLocalConversations,
	removeLocalConversation,
	renameLocalConversation,
} from "../../../shared/storage/localData";

export async function listConversations() {
	return listLocalConversations();
}

export async function deleteConversation(conversationId: string) {
	return removeLocalConversation(conversationId);
}

export async function renameConversation(
	conversationId: string,
	input: Required<Pick<RenameConversationRequest, "title">>,
) {
	return renameLocalConversation(conversationId, input.title);
}

export async function getConversation(conversationId: string) {
	return getLocalConversationPayload(conversationId);
}

export type { ConversationPayload, ConversationSummary };
