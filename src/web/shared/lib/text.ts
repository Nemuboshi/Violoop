export function normalizeSingleLine(value: string, fallback: string) {
	return value.replace(/\s+/g, " ").trim() || fallback;
}

export function splitCommaList(value: string) {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

export function slugifyName(value: string, fallback: string) {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, "")
			.replace(/\s+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "") || fallback
	);
}
