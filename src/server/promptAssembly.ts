import { assemblePrompt } from "../shared/domain/prompt";
import type {
	ChatMessage,
	LoadedTactic,
	PromptBlock,
	SessionCapabilities,
	SessionClock,
	SessionProfile,
	StoredCompaction,
	TimelineItem,
} from "../shared/types";

export type PromptAssembly = {
	promptBlocks: PromptBlock[];
	messages: ChatMessage[];
};

export function assembleChatPrompt(input: {
	globalSystemPrompt: string;
	profile: SessionProfile;
	capabilities: SessionCapabilities;
	clock: SessionClock | null;
	timeline: TimelineItem[];
	summary?: StoredCompaction;
	tactics: LoadedTactic[];
}): PromptAssembly {
	return assemblePrompt(input);
}
