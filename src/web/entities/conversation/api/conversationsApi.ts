import type {
	ConversationPayload,
	ConversationSummary,
	ConversationsResponse,
	CreateConversationRequest,
	RenameConversationRequest,
} from "../../../../shared/types";
import { fetchJson, fetchJsonOrNull } from "../../../shared/api";

export async function fetchConversations() {
	const payload =
		await fetchJsonOrNull<Partial<ConversationsResponse>>("/api/conversations");
	return payload?.conversations ?? [];
}

export async function deleteConversation(conversationId: string) {
	const payload = await fetchJson<Partial<ConversationsResponse>>(
		`/api/conversations/${encodeURIComponent(conversationId)}`,
		{ method: "DELETE" },
		{
			errorMessage: (status, payload) =>
				typeof payload?.error === "string"
					? payload.error
					: `Conversation delete failed with ${status}`,
		},
	);
	return payload.conversations ?? [];
}

export async function renameConversation(
	conversationId: string,
	input: Required<Pick<RenameConversationRequest, "title">>,
) {
	const payload = await fetchJson<Partial<ConversationsResponse>>(
		`/api/conversations/${encodeURIComponent(conversationId)}`,
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		},
		{
			errorMessage: (status, payload) =>
				typeof payload?.error === "string"
					? payload.error
					: `Conversation rename failed with ${status}`,
		},
	);
	return payload.conversations ?? [];
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
	const payload = await fetchJson<Partial<ConversationPayload>>(
		"/api/conversations",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		},
		{
			errorMessage: (status, payload) =>
				typeof payload?.error === "string"
					? payload.error
					: `Conversation create failed with ${status}`,
		},
	);
	if (
		!payload.conversation ||
		payload.clock === undefined ||
		!payload.timelineItems
	) {
		throw new Error("Conversation create response was empty.");
	}
	return payload as ConversationPayload;
}

export async function fetchConversation(conversationId: string) {
	const payload = await fetchJson<Partial<ConversationPayload>>(
		`/api/conversations/${encodeURIComponent(conversationId)}/messages`,
		undefined,
		{
			errorMessage: (status) => `Conversation request failed with ${status}`,
		},
	);
	if (
		!payload.conversation ||
		payload.clock === undefined ||
		!payload.timelineItems
	) {
		throw new Error("Conversation response was empty.");
	}
	return payload as ConversationPayload;
}

export type { ConversationSummary };
