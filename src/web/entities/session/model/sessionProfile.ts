import type {
	SessionCapabilities,
	SessionProfile,
} from "../../../../shared/types";
import { normalizeSingleLine } from "../../../shared/lib";

export const defaultSessionProfile: SessionProfile = {
	assistantName: "Violoop",
	userRole: "The user is asking for practical help.",
	assistantRole: "A concise assistant that answers directly.",
};

export const defaultSessionCapabilities: SessionCapabilities = {
	tactics: true,
	dayProgression: false,
	sessionState: false,
	sceneEvents: false,
};

export function defaultNewChatDraft(): SessionProfile {
	return {
		assistantName: defaultSessionProfile.assistantName,
		userRole: defaultSessionProfile.userRole,
		assistantRole: defaultSessionProfile.assistantRole,
	};
}

export function toSessionCapabilities(
	draft: SessionCapabilities,
): SessionCapabilities {
	return {
		tactics: Boolean(draft.tactics),
		dayProgression: Boolean(draft.dayProgression),
		sessionState: Boolean(draft.sessionState),
		sceneEvents: Boolean(draft.sceneEvents),
	};
}

export function toSessionProfile(draft: SessionProfile): SessionProfile {
	return {
		assistantName: normalizeSingleLine(
			draft.assistantName,
			defaultSessionProfile.assistantName,
		),
		userRole: normalizeSingleLine(
			draft.userRole,
			defaultSessionProfile.userRole,
		),
		assistantRole: normalizeSingleLine(
			draft.assistantRole,
			defaultSessionProfile.assistantRole,
		),
	};
}
