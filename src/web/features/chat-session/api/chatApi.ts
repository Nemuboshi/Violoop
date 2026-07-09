import type { ChatResponse } from "../../../../shared/types";
import { fetchJson } from "../../../shared/api";

export async function sendChatMessage(input: {
	conversationId: string;
	message: string;
}) {
	return fetchJson<Partial<ChatResponse>>("/api/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
}

export async function editLastUserMessage(input: {
	conversationId: string;
	message: string;
}) {
	return fetchJson<Partial<ChatResponse>>("/api/chat/edit-last", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
}
