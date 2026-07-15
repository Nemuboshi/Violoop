export async function fetchJson<T>(
	input: RequestInfo | URL,
	init?: RequestInit,
	options: {
		errorMessage?: (
			status: number,
			payload: Record<string, unknown> | null,
		) => string;
	} = {},
): Promise<T> {
	const response = await fetch(input, init);
	if (!response.ok) {
		const payload = await response.json().catch(() => null);
		throw new Error(
			options.errorMessage?.(response.status, payload) ||
				readError(payload) ||
				`Request failed with ${response.status}`,
		);
	}

	return (await response.json()) as T;
}

function readError(payload: unknown) {
	if (!payload || typeof payload !== "object") {
		return "";
	}

	const record = payload as Record<string, unknown>;
	return typeof record.detail === "string"
		? record.detail
		: typeof record.error === "string"
			? record.error
			: "";
}
