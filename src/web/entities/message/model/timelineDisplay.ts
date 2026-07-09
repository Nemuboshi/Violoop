import type {
	ChatUsage,
	SessionProfile,
	TimelineItem,
} from "../../../../shared/types";

export function formatCacheHit(usage: ChatUsage) {
	if (usage.cacheHitRate === undefined) {
		return "cache n/a";
	}

	return `${Math.round(usage.cacheHitRate * 100)}% cache hit`;
}

export function formatToken(value: number | undefined) {
	return value === undefined ? "n/a" : value.toLocaleString();
}

export function timelineSpeaker(
	message: TimelineItem,
	profile: SessionProfile,
) {
	if (message.kind === "day_transition") {
		return "Day";
	}

	if (message.kind === "scene") {
		return "Scene";
	}

	if (message.speakerName) {
		return message.speakerName;
	}

	if (message.role === "user") {
		return "You";
	}

	return profile.assistantName;
}

export function timelineItemClassName(message: TimelineItem) {
	if (message.kind === "day_transition") {
		return "flex justify-center py-3 text-sm";
	}

	if (message.kind === "scene") {
		return "grid gap-1 border-t border-neutral-200 py-3 text-sm first:border-t-0";
	}

	if (message.kind === "state_update") {
		return "grid gap-1 border-t border-neutral-200 py-3 text-sm text-neutral-500 first:border-t-0";
	}

	if (message.role === "user") {
		return "flex flex-col items-end gap-1 border-t border-neutral-200 py-3 text-sm first:border-t-0";
	}

	return "flex flex-col items-start gap-1 border-t border-neutral-200 py-3 text-sm first:border-t-0";
}

export function timelineSpeakerClassName(message: TimelineItem) {
	if (message.kind === "day_transition") {
		return "sr-only";
	}

	if (message.kind === "scene") {
		return "text-xs font-bold uppercase tracking-normal text-neutral-600";
	}

	if (message.role === "user") {
		return "text-xs font-bold uppercase tracking-normal text-neutral-600";
	}

	return "text-xs font-bold uppercase tracking-normal text-neutral-600";
}

export function timelineContentClassName(message: TimelineItem) {
	const base =
		"m-0 whitespace-pre-wrap break-words text-sm leading-6 text-neutral-950";

	if (message.kind === "day_transition") {
		return `${base} border border-neutral-950 bg-white px-3 py-1 text-center font-bold leading-5`;
	}

	if (message.kind === "scene") {
		return `${base} max-w-[760px] border border-neutral-950 bg-white px-3 py-2 text-neutral-700`;
	}

	if (message.kind === "state_update") {
		return `${base} text-neutral-500`;
	}

	if (message.role === "user") {
		return `${base} max-w-[min(680px,82%)] border border-neutral-950 bg-neutral-100 px-3 py-2`;
	}

	return `${base} max-w-[min(680px,82%)] border border-neutral-950 bg-white px-3 py-2`;
}
