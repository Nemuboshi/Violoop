import type { ChatResponse } from "../../../../shared/types";
import { editLocalLastUserMessage, sendLocalChatMessage } from "./localChat";

export async function sendChatMessage(input: {
	conversationId: string;
	message: string;
}): Promise<Partial<ChatResponse>> {
	return sendLocalChatMessage(input);
}

export async function editLastUserMessage(input: {
	conversationId: string;
	message: string;
}): Promise<Partial<ChatResponse>> {
	return editLocalLastUserMessage(input);
}
