import type {
	ConversationPayload,
	ConversationSummary,
	CreateConversationRequest,
	RenameConversationRequest,
} from "../../../../shared/types";
import {
	createLocalConversation,
	getLocalConversationPayload,
	listLocalConversations,
	removeLocalConversation,
	renameLocalConversation,
} from "../../../shared/storage/localData";

export async function fetchConversations() {
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

export async function createConversation(
	input: Required<
		Pick<
			CreateConversationRequest,
			| "title"
			| "profile"
			| "capabilities"
			| "allowedTacticIds"
			| "enabledStateIds"
		>
	>,
) {
	return createLocalConversation(input);
}

export async function fetchConversation(conversationId: string) {
	return getLocalConversationPayload(conversationId);
}

export type { ConversationPayload, ConversationSummary };
