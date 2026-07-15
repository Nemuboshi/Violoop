import { Hono } from "hono";
import { cors } from "hono/cors";
import { getProviderAdapter } from "../providers/index";
import { testProvider } from "../providers/providerTest";
import type {
	ChatMessage,
	ChatStreamEvent,
	ChatUsage,
	PromptBlock,
	ProviderConfig,
	ProviderTestRequest,
	StreamChatOptions,
	ThinkingLevel,
} from "../shared/types";

export type WorkerBindings = {
	ASSETS?: { fetch(request: Request): Promise<Response> };
	VIOLOOP_ALLOWED_ORIGINS?: string;
	VIOLOOP_ALLOWED_PROVIDER_HOSTS?: string;
};

type WorkerChatRequest = {
	provider?: ProviderConfig & { id?: string; model?: { id: string } };
	messages?: ChatMessage[];
	promptBlocks?: PromptBlock[];
	temperature?: number;
	thinkingLevel?: ThinkingLevel;
	cache?: StreamChatOptions["cache"];
};

export const workerApp = new Hono<{ Bindings: WorkerBindings }>();

workerApp.use("/api/*", async (context, next) => {
	const allowedOrigins = context.env?.VIOLOOP_ALLOWED_ORIGINS?.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
	return cors({
		origin: allowedOrigins?.length
			? allowedOrigins
			: [context.req.header("Origin") ?? ""],
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type"],
	})(context, next);
});

workerApp.get("/api/health", (context) => context.json({ ok: true }));

workerApp.post("/api/chat", async (context) => {
	const body = await readJson<WorkerChatRequest>(context.req.raw);
	const provider = normalizeProvider(
		body.provider,
		context.env?.VIOLOOP_ALLOWED_PROVIDER_HOSTS,
	);
	const messages = requireMessages(body.messages);
	const promptBlocks = Array.isArray(body.promptBlocks)
		? body.promptBlocks
		: [];
	const adapter = getProviderAdapter(provider.api);
	let text = "";
	let usage: ChatUsage | undefined;

	for await (const event of adapter.streamChat({
		provider,
		messages,
		promptBlocks,
		temperature: body.temperature,
		thinkingLevel: body.thinkingLevel,
		cache: body.cache,
	})) {
		if (event.type === "text") text += event.text;
		if (event.type === "usage") usage = event.usage;
	}

	return context.json({ text, usage });
});

workerApp.post("/api/providers/test", async (context) => {
	const body = await readJson<ProviderTestRequest>(context.req.raw);
	if (!body.provider || !body.model) {
		throw new WorkerRequestError(400, "Provider and model are required.");
	}
	assertSafeProviderUrl(
		body.provider.baseUrl,
		context.env?.VIOLOOP_ALLOWED_PROVIDER_HOSTS,
	);

	const result = await testProvider(
		body.providerId ?? "draft",
		body.provider,
		body.model,
	);
	return context.json(result);
});

workerApp.notFound(async (context) => {
	if (context.env?.ASSETS) {
		return context.env.ASSETS.fetch(context.req.raw);
	}
	return context.json({ error: "Not found" }, 404);
});

workerApp.onError((error, context) => {
	const err = error as Error & {
		status?: number;
		statusCode?: number;
		detail?: string;
	};
	const status =
		[err.status, err.statusCode].find((value) => typeof value === "number") ??
		500;
	const detail = typeof err.detail === "string" ? err.detail : undefined;
	const message = err.message || "Unexpected server error";
	return context.json(
		{ error: message, ...(detail ? { detail } : {}) },
		status as
			| 400
			| 401
			| 403
			| 404
			| 409
			| 413
			| 422
			| 429
			| 500
			| 502
			| 503
			| 504,
	);
});
const maxRequestBytes = 2 * 1024 * 1024;

async function readJson<T>(request: Request): Promise<T> {
	const contentLength = Number(request.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
		throw new WorkerRequestError(413, "Request payload is too large.");
	}
	try {
		const text = await request.text();
		if (new TextEncoder().encode(text).byteLength > maxRequestBytes) {
			throw new WorkerRequestError(413, "Request payload is too large.");
		}
		return JSON.parse(text) as T;
	} catch (error) {
		if (error instanceof WorkerRequestError) throw error;
		throw new WorkerRequestError(400, "Invalid JSON payload.");
	}
}

function normalizeProvider(
	input: WorkerChatRequest["provider"],
	allowedProviderHosts?: string,
) {
	if (!input || typeof input.baseUrl !== "string" || !input.baseUrl.trim()) {
		throw new WorkerRequestError(400, "Provider configuration is required.");
	}
	if (input.api !== "openai-completions") {
		throw new WorkerRequestError(
			400,
			`Provider API "${String(input.api)}" is not supported.`,
		);
	}
	const modelId = input.model?.id;
	if (!modelId)
		throw new WorkerRequestError(400, "Provider model is required.");

	assertSafeProviderUrl(input.baseUrl, allowedProviderHosts);

	const headers = Object.fromEntries(
		Object.entries(input.headers ?? {}).filter(([key]) =>
			/^(accept|content-type|x-[a-z0-9-]+)$/i.test(key),
		),
	);
	return {
		id: input.id ?? "browser",
		name: input.name ?? input.id ?? "browser",
		baseUrl: input.baseUrl.replace(/\/+$/, ""),
		api: input.api,
		model: {
			id: modelId,
			...(input.models?.find((model) => model.id === modelId) ?? {}),
		},
		apiKey: input.apiKey,
		authHeader: input.authHeader ?? true,
		headers,
		compat: { ...(input.compat ?? {}) },
	};
}

function requireMessages(value: unknown): ChatMessage[] {
	if (
		!Array.isArray(value) ||
		value.some((message) => !isChatMessage(message))
	) {
		throw new WorkerRequestError(400, "Chat messages are required.");
	}
	return value;
}

function isChatMessage(value: unknown): value is ChatMessage {
	if (!value || typeof value !== "object") return false;
	const message = value as Record<string, unknown>;
	return (
		["system", "developer", "user", "assistant"].includes(
			String(message.role),
		) && typeof message.content === "string"
	);
}

function assertSafeProviderUrl(baseUrl: string, allowedProviderHosts?: string) {
	if (typeof baseUrl !== "string" || !baseUrl.trim()) {
		throw new WorkerRequestError(400, "Provider configuration is required.");
	}
	let url: URL;
	try {
		url = new URL(baseUrl);
	} catch {
		throw new WorkerRequestError(400, "Provider base URL is invalid.");
	}
	if (url.protocol !== "https:" && !isLocalDevelopmentUrl(url.hostname)) {
		throw new WorkerRequestError(400, "Provider base URL must use HTTPS.");
	}
	if (
		url.username ||
		url.password ||
		isPrivateHostname(url.hostname) ||
		!isAllowedProviderHost(url.hostname, allowedProviderHosts)
	) {
		throw new WorkerRequestError(400, "Provider base URL is not allowed.");
	}
}

function isAllowedProviderHost(hostname: string, configured?: string) {
	if (!configured?.trim()) return true;
	const hosts = configured
		.split(",")
		.map((host) => host.trim().toLowerCase())
		.filter(Boolean);
	return hosts.includes(hostname.toLowerCase());
}

function isLocalDevelopmentUrl(hostname: string) {
	return (
		hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
	);
}

function isPrivateIpv4(hostname: string) {
	const octets = hostname.split(".").map(Number);
	if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet)))
		return false;
	return (
		octets[0] === 10 ||
		(octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
		(octets[0] === 192 && octets[1] === 168) ||
		(octets[0] === 169 && octets[1] === 254)
	);
}

function isPrivateHostname(hostname: string) {
	if (isLocalDevelopmentUrl(hostname)) return false;
	if (hostname === "0.0.0.0" || hostname.endsWith(".internal")) return true;

	const bare =
		hostname.startsWith("[") && hostname.endsWith("]")
			? hostname.slice(1, -1)
			: hostname;
	const lowerBare = bare.toLowerCase();

	if (lowerBare === "::") return true;
	if (/^fe[89ab][0-9a-f]:/.test(lowerBare)) return true; // fe80::/10 link-local
	if (/^f[cd][0-9a-f]{2}:/.test(lowerBare)) return true; // fc00::/7 ULA

	// IPv4-mapped IPv6 (::ffff:a9fe:101) — the WHATWG URL parser normalizes
	// a dotted-form address (::ffff:169.254.1.1) into this hex shape.
	const hexMapped = lowerBare.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
	if (hexMapped) {
		const hi = Number.parseInt(hexMapped[1], 16);
		const lo = Number.parseInt(hexMapped[2], 16);
		const mappedIpv4 = [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join(".");
		return isPrivateIpv4(mappedIpv4);
	}

	return isPrivateIpv4(hostname);
}

export class WorkerRequestError extends Error {
	constructor(
		readonly statusCode: number,
		message: string,
	) {
		super(message);
	}
}

export type { ChatStreamEvent };
