import type {
	ConversationSummary,
	TimelineItem,
} from "../../../../shared/types";
import { createClientId } from "../../../shared/lib";
import {
	appendLocalItemsAtomic,
	getConfig,
} from "../../../shared/storage/repository";
import { generateOpeningScenesLocal } from "./localRuntime";

export async function createLocalOpeningTimeline(
	conversation: ConversationSummary,
) {
	const config = await getConfig();
	if (!config) throw new Error("Local configuration is unavailable.");
	const items: TimelineItem[] = [];
	if (conversation.capabilities.dayProgression) {
		items.push(
			makeItem(conversation, {
				kind: "day_transition",
				role: "system",
				speakerName: "System",
				content: "Day 1",
				promptVisibility: "context",
				metadata: { day: 1 },
			}),
		);
	}
	if (conversation.capabilities.sceneEvents) {
		const scenes = await generateOpeningScenesLocal({ conversation, config });
		for (const scene of scenes) {
			items.push(
				makeItem(conversation, {
					kind: "scene",
					role: "system",
					speakerName: "Scene",
					content: scene,
					promptVisibility: "context",
					metadata: conversation.capabilities.dayProgression
						? { day: 1 }
						: undefined,
				}),
			);
		}
	}
	if (items.length) await appendLocalItemsAtomic(conversation, items);
	return items;
}

function makeItem(
	conversation: ConversationSummary,
	input: Omit<TimelineItem, "id" | "conversationId" | "createdAt">,
): TimelineItem {
	return {
		...input,
		id: createClientId("message"),
		conversationId: conversation.id,
		createdAt: new Date().toISOString(),
	};
}
