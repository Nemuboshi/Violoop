const databaseName = "violoop";
const databaseVersion = 5;

const stores = [
	"meta",
	"config",
	"conversations",
	"timelineItems",
	"compactions",
	"sessionClocks",
	"sessionTactics",
	"sessionStates",
	"tactics",
	"stateDefinitions",
	"tacticRuns",
	"usage",
] as const;

export type StoreName = (typeof stores)[number];
type MemoryStore = Map<IDBValidKey, unknown>;
const memoryStores = new Map<StoreName, MemoryStore>();

export type LocalTransactionOperation =
	| { type: "put"; storeName: StoreName; value: unknown; key?: IDBValidKey }
	| { type: "delete"; storeName: StoreName; key: IDBValidKey }
	| { type: "clear"; storeName: StoreName };

export async function openVioloopDatabase(): Promise<IDBDatabase | null> {
	if (typeof indexedDB === "undefined") return null;
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName, databaseVersion);
		request.onupgradeneeded = () => {
			const database = request.result;
			for (const store of stores) {
				if (!database.objectStoreNames.contains(store)) {
					database.createObjectStore(store, { keyPath: keyPathFor(store) });
				}
			}
			const upgradeTransaction = request.transaction as IDBTransaction;
			upgradeTransaction.objectStore("meta").put({
				id: "schema",
				version: databaseVersion,
				migratedAt: new Date().toISOString(),
			});
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(new Error("Unable to open local database."));
	});
}

export async function getLocal<T>(
	storeName: StoreName,
	key: IDBValidKey,
): Promise<T | undefined> {
	const database = await openVioloopDatabase();
	if (!database) return memoryStores.get(storeName)?.get(key) as T | undefined;
	return request<T | undefined>(database, storeName, "readonly", (store) =>
		store.get(key),
	);
}

export async function listLocal<T>(storeName: StoreName): Promise<T[]> {
	const database = await openVioloopDatabase();
	if (!database) {
		return [...(memoryStores.get(storeName)?.values() || [])] as T[];
	}
	return request<T[]>(database, storeName, "readonly", (store) =>
		store.getAll(),
	);
}

export async function putLocal<T>(
	storeName: StoreName,
	value: T,
	key?: IDBValidKey,
) {
	await runLocalTransaction([{ type: "put", storeName, value, key }]);
}

export async function deleteLocal(storeName: StoreName, key: IDBValidKey) {
	await runLocalTransaction([{ type: "delete", storeName, key }]);
}

export async function clearLocal(storeName: StoreName) {
	await runLocalTransaction([{ type: "clear", storeName }]);
}

export async function runLocalTransaction(
	operations: LocalTransactionOperation[],
) {
	if (operations.length === 0) return;
	const database = await openVioloopDatabase();
	if (!database) {
		const snapshots = new Map<StoreName, MemoryStore>();
		for (const operation of operations) {
			if (!snapshots.has(operation.storeName)) {
				snapshots.set(
					operation.storeName,
					new Map(memoryStores.get(operation.storeName)),
				);
			}
		}
		try {
			for (const operation of operations) applyMemoryOperation(operation);
		} catch (error) {
			for (const [storeName, snapshot] of snapshots)
				memoryStores.set(storeName, snapshot);
			throw error;
		}
		return;
	}
	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction(
			[...new Set(operations.map((operation) => operation.storeName))],
			"readwrite",
		);
		for (const operation of operations) {
			const store = transaction.objectStore(operation.storeName);
			if (operation.type === "put") store.put(operation.value);
			if (operation.type === "delete") store.delete(operation.key);
			if (operation.type === "clear") store.clear();
		}
		transaction.oncomplete = () => resolve();
		const fail = () => reject(new Error("Local database transaction failed."));
		transaction.onerror = fail;
		transaction.onabort = fail;
	});
}

export function resetMemoryDatabase() {
	memoryStores.clear();
}

function applyMemoryOperation(operation: LocalTransactionOperation) {
	const store =
		memoryStores.get(operation.storeName) ?? new Map<IDBValidKey, unknown>();
	if (operation.type === "put")
		store.set(
			operation.key ?? keyFromValue(operation.storeName, operation.value),
			operation.value,
		);
	if (operation.type === "delete") store.delete(operation.key);
	if (operation.type === "clear") store.clear();
	memoryStores.set(operation.storeName, store);
}

function keyPathFor(store: StoreName) {
	if (store === "config" || store === "meta") return "id";
	if (["sessionClocks", "sessionTactics", "sessionStates"].includes(store))
		return "conversationId";
	if (store === "usage") return "requestId";
	return "id";
}

function keyFromValue(storeName: StoreName, value: unknown): IDBValidKey {
	const keyPath = keyPathFor(storeName);
	if (value && typeof value === "object" && keyPath in value) {
		return String((value as Record<string, unknown>)[keyPath]);
	}
	return "current";
}

function request<T>(
	database: IDBDatabase,
	storeName: StoreName,
	mode: IDBTransactionMode,
	operation: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const transaction = database.transaction(storeName, mode);
		const result = operation(transaction.objectStore(storeName));
		result.onsuccess = () => resolve(result.result as T);
		result.onerror = () => reject(new Error("Local database request failed."));
		transaction.onerror = () =>
			reject(new Error("Local database transaction failed."));
	});
}
