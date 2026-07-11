import type { Tactic, UserState } from "../types";

export type TacticDecision = {
	tacticId: string;
	name: string;
	score: number;
	loaded: boolean;
	decision: "loaded" | "skipped";
	reasons: string[];
	matchedKeywords: string[];
	contraindications: string[];
};

export function scoreTactic(
	tactic: Pick<
		Tactic,
		"id" | "name" | "keywords" | "emotionRules" | "blockedKeywords"
	>,
	message: string,
	states: UserState[],
): TacticDecision {
	const normalized = message.toLowerCase();
	const matchedKeywords = tactic.keywords.filter((keyword) =>
		normalized.includes(keyword.toLowerCase()),
	);
	const contraindications = tactic.blockedKeywords.filter((keyword) =>
		normalized.includes(keyword.toLowerCase()),
	);
	const emotionMatches = tactic.emotionRules.filter((rule) => {
		const state = states.find((item) => item.key === rule.key);
		return state
			? rule.operator === ">="
				? state.value >= rule.value
				: state.value <= rule.value
			: false;
	});
	const score = Number(
		(
			Math.min(matchedKeywords.length * 0.5, 1) +
			Math.min(emotionMatches.length * 0.35, 0.7)
		).toFixed(3),
	);
	const reasons = [
		...(matchedKeywords.length
			? [`matched keywords: ${matchedKeywords.join(", ")}`]
			: []),
		...(emotionMatches.length
			? [
					`matched emotion rules: ${emotionMatches.map((rule) => `${rule.key}${rule.operator}${rule.value}`).join(", ")}`,
				]
			: []),
		...(contraindications.length
			? [`blocked by keywords: ${contraindications.join(", ")}`]
			: []),
	];
	const loaded =
		contraindications.length === 0 &&
		(matchedKeywords.length > 0 || emotionMatches.length > 0);
	return {
		tacticId: tactic.id,
		name: tactic.name,
		score,
		loaded,
		decision: loaded ? "loaded" : "skipped",
		reasons: reasons.length ? reasons : ["no trigger matched"],
		matchedKeywords,
		contraindications,
	};
}
