import type { SessionProfile } from "../../../../shared/types";
import { normalizeSingleLine } from "../../../shared/lib";

export const defaultSessionProfile: SessionProfile = {
	assistantName: "Violoop",
	userRole: "The user is asking for practical help.",
	assistantRole: "A concise assistant that answers directly.",
};

export function defaultNewChatDraft(): SessionProfile {
	return {
		assistantName: defaultSessionProfile.assistantName,
		userRole: defaultSessionProfile.userRole,
		assistantRole: defaultSessionProfile.assistantRole,
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
