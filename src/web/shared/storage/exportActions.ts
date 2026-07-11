import { putLocal } from "./database";
import { exportLocalData, parseImport, serializeExport } from "./export";
import { type ImportConflictStrategy, importLocalData } from "./import";

export async function downloadLocalExport() {
	const data = await exportLocalData();
	const blob = new Blob([serializeExport(data)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `violoop-export-${new Date().toISOString().slice(0, 10)}.json`;
	anchor.click();
	URL.revokeObjectURL(url);
	return data;
}

export async function importLocalExport(
	file: File,
	strategy: ImportConflictStrategy = "replace",
	options: {
		confirm?: (preview: {
			conversations: number;
			tactics: number;
			stateDefinitions: number;
		}) => boolean | Promise<boolean>;
	} = {},
) {
	if (file.size > 20 * 1024 * 1024)
		throw new Error("Import file is too large.");
	const data = parseImport(await file.text());
	const preview = {
		conversations: data.conversations.length,
		tactics: data.tactics.length,
		stateDefinitions: data.stateDefinitions.length,
	};
	if (options.confirm && !(await options.confirm(preview))) {
		throw new Error("Import cancelled.");
	}
	// Keep an explicit snapshot in local metadata before replacing valid data.
	if (strategy === "replace") {
		const snapshot = await exportLocalData();
		await putLocal("meta", {
			id: `backup:${new Date().toISOString()}`,
			exportedAt: snapshot.exportedAt,
			data: snapshot,
		});
	}
	return importLocalData(data, { strategy });
}
