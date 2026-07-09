import type {
	Tactic,
	TacticEmotionOperator,
	TacticOverview,
} from "../../../../shared/types";
import { slugifyName, splitCommaList } from "../../../shared/lib";

export type TacticEditorDraft = {
	id: string;
	originalId: string | null;
	name: string;
	keywords: string;
	instruction: string;
	emotionRules: Array<{
		key: string;
		operator: TacticEmotionOperator;
		value: string;
	}>;
	blockedKeywords: string;
};

export const emotionOperatorOptions: Array<{
	label: string;
	value: TacticEmotionOperator;
}> = [
	{ label: "At least", value: ">=" },
	{ label: "At most", value: "<=" },
];

export function newTacticEditorDraft(): TacticEditorDraft {
	return {
		id: slugifyTacticName("New tactic"),
		originalId: null,
		name: "New tactic",
		keywords: "",
		instruction: "",
		emotionRules: [],
		blockedKeywords: "",
	};
}

export function toTacticEditorDraft(tactic: TacticOverview): TacticEditorDraft {
	return {
		id: tactic.id,
		originalId: tactic.id,
		name: tactic.name,
		keywords: tactic.keywords.join(", "),
		instruction: tactic.instruction,
		emotionRules: tactic.emotionRules.map((rule) => ({
			...rule,
			value: String(rule.value),
		})),
		blockedKeywords: tactic.blockedKeywords.join(", "),
	};
}

export function fromTacticEditorDraft(draft: TacticEditorDraft): Tactic {
	return {
		id: draft.originalId ?? slugifyTacticName(draft.name),
		name: draft.name,
		keywords: splitCommaList(draft.keywords),
		emotionRules: draft.emotionRules
			.map((rule) => ({
				key: rule.key,
				operator: rule.operator,
				value: Number(rule.value),
			}))
			.filter((rule) => Number.isFinite(rule.value)),
		blockedKeywords: splitCommaList(draft.blockedKeywords),
		instruction: draft.instruction.trim(),
	};
}

export function slugifyTacticName(value: string) {
	return slugifyName(value, "new-tactic");
}
