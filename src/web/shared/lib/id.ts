export function createClientId(prefix = "client") {
	if (globalThis.crypto?.randomUUID) {
		return globalThis.crypto.randomUUID();
	}

	return `${prefix}-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 10)}`;
}
