import type { FastifyInstance } from "fastify";
import type {
	ConversationPayload,
	ConversationsResponse,
	CreateConversationRequest,
	RenameConversationRequest,
	SessionCapabilities,
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
	ensureSessionUserState,
	initializeSessionTactics,
	requiredStateIdsForTacticSelection,
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
			const requiredStateIds = body.capabilities?.tactics
				? await requiredStateIdsForTacticSelection(body.allowedTacticIds)
				: [];
			const sessionStateEnabled =
				body.capabilities?.sessionState === true || requiredStateIds.length > 0;
			const enabledStateIds = sessionStateEnabled
				? mergeStateIds(body.enabledStateIds, requiredStateIds)
				: [];
			const conversation = await createConversation({
				title: body.title,
				profile: body.profile,
				capabilities: normalizeRequestedCapabilities(
					body.capabilities,
					sessionStateEnabled,
				),
			});
			if (conversation.capabilities.tactics) {
				await validateTacticStateSelection(
					body.allowedTacticIds,
					enabledStateIds,
				);
				await initializeSessionTactics(
					conversation.id,
					body.allowedTacticIds,
					enabledStateIds,
				);
			} else {
				await initializeSessionTactics(conversation.id, [], []);
			}
			if (conversation.capabilities.sessionState) {
				await ensureSessionUserState(conversation.id, enabledStateIds);
			}
			const clock = conversation.capabilities.dayProgression
				? await ensureSessionClock(conversation.id)
				: null;
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
				clock: conversation.capabilities.dayProgression
					? await ensureSessionClock(conversationId)
					: null,
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

function mergeStateIds(
	stateIds: string[] | undefined,
	requiredStateIds: string[],
) {
	return [...new Set([...(stateIds ?? []), ...requiredStateIds])];
}

function normalizeRequestedCapabilities(
	capabilities: SessionCapabilities | undefined,
	sessionState: boolean,
): SessionCapabilities {
	return {
		tactics: capabilities?.tactics ?? true,
		dayProgression: capabilities?.dayProgression ?? false,
		sessionState,
		sceneEvents: capabilities?.sceneEvents ?? false,
	};
}
