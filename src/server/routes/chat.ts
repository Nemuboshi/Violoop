import type { FastifyInstance } from "fastify";
import type { ChatRequest } from "../../shared/types";
import { editLastUserMessage, processChat } from "../services/chatService";

export async function registerChatRoutes(app: FastifyInstance) {
	app.post("/api/chat", async (request) =>
		processChat(request.body as ChatRequest),
	);
	app.post("/api/chat/edit-last", async (request) =>
		editLastUserMessage(request.body as ChatRequest),
	);
}
