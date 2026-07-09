export class HttpError extends Error {
	constructor(
		readonly statusCode: number,
		message: string,
		readonly payload: Record<string, unknown> = { error: message },
	) {
		super(message);
	}
}
