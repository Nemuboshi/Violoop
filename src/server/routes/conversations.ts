import type { FastifyInstance } from "fastify";
import type {
	ConversationPayload,
	ConversationsResponse,
	CreateConversationRequest,
	RenameConversationRequest,
} from "../../shared/types";
import { loadConfig, resolveActiveProvider } from "../config";
import {
	createConversation,
	deleteConversation,
	getConversation,
	listConversations,
	listTimelineItems,
	renameConversation,
} from "../conversations";
import { HttpError } from "../httpErrors";
import { getProviderAdapter } from "../providers";
import { createOpeningTimeline, ensureSessionClock } from "../runtime";
import {
	initializeSessionTactics,
	validateTacticStateSelection,
} from "../tactics";

export async function registerConversationRoutes(app: FastifyInstance) {
	app.get(
		"/api/conversations",
		async (): Promise<ConversationsResponse> => ({
			conversations: await listConversations(),
		}),
	);

	app.post(
		"/api/conversations",
		async (request): Promise<ConversationPayload> => {
			const body = request.body as CreateConversationRequest;
			const config = await loadConfig();
			const provider = resolveActiveProvider(config);
			const adapter = getProviderAdapter(provider.api);
			await validateTacticStateSelection(
				body.allowedTacticIds,
				body.enabledStateIds,
			);
			const conversation = await createConversation({
				title: body.title,
				profile: body.profile,
			});
			await initializeSessionTactics(
				conversation.id,
				body.allowedTacticIds,
				body.enabledStateIds,
			);
			const clock = await ensureSessionClock(conversation.id);
			const timelineItems = await createOpeningTimeline({
				conversation,
				config,
				provider,
				adapter,
			});
			return { conversation, clock, timelineItems };
		},
	);

	app.get(
		"/api/conversations/:conversationId/messages",
		async (request): Promise<ConversationPayload> => {
			const { conversationId } = request.params as { conversationId: string };
			const conversation = await getConversation(conversationId);
			if (!conversation) {
				throw new HttpError(
					404,
					`Conversation "${conversationId}" was not found.`,
				);
			}

			return {
				conversation,
				clock: await ensureSessionClock(conversationId),
				timelineItems: await listTimelineItems(conversationId),
			};
		},
	);

	app.delete(
		"/api/conversations/:conversationId",
		async (request): Promise<ConversationsResponse> => {
			const { conversationId } = request.params as { conversationId: string };
			await deleteConversation(conversationId);
			return { conversations: await listConversations() };
		},
	);

	app.patch(
		"/api/conversations/:conversationId",
		async (request): Promise<ConversationsResponse> => {
			const { conversationId } = request.params as { conversationId: string };
			const body = request.body as RenameConversationRequest;
			await renameConversation(conversationId, body.title);
			return { conversations: await listConversations() };
		},
	);
}
