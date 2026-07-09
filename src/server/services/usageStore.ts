import type { ChatUsage } from "../../shared/types";

const usageByRequestId = new Map<string, ChatUsage>();
const maxUsageEntries = 200;

export function getUsage(requestId: string) {
	return usageByRequestId.get(requestId) ?? null;
}

export function storeUsage(requestId: string, usage: ChatUsage) {
	usageByRequestId.set(requestId, usage);

	while (usageByRequestId.size > maxUsageEntries) {
		const oldestRequestId = usageByRequestId.keys().next().value as string;
		usageByRequestId.delete(oldestRequestId);
	}
}

export function logUsage(requestId: string, usage: ChatUsage) {
	const cached = usage.cachedPromptTokens ?? 0;
	const prompt = usage.promptTokens ?? 0;
	const hitRate =
		usage.cacheHitRate !== undefined
			? `${Math.round(usage.cacheHitRate * 100)}%`
			: "n/a";
	console.log(
		`[usage] request=${requestId} prompt=${prompt} cached=${cached} completion=${usage.completionTokens ?? 0} total=${
			usage.totalTokens ?? 0
		} cacheHit=${hitRate}`,
	);
}
