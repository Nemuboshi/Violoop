import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const force = process.argv.includes("--force");
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
	process.loadEnvFile(envPath);
}

const dataDir = resolve(process.env.VIOLOOP_DATA_DIR ?? "data");
const settingsPath = resolve(dataDir, "settings.json");
const tacticsPath = resolve(dataDir, "tactics.json");
const statesPath = resolve(dataDir, "states.json");

const defaultSettings = {
	chat: {
		defaultProvider: "codex",
		defaultModel: "gpt-5.5",
		systemPrompt:
			"You are Violoop, a concise assistant. Answer directly, ask focused follow-up questions only when required, and keep formatting easy to scan.",
		temperature: 0.7,
		thinkingLevel: "off",
		cache: {
			systemPrompt: true,
		},
		compaction: {
			enabled: true,
			triggerTokens: 60000,
			keepRecentTokens: 20000,
		},
	},
	providers: {
		codex: {
			name: "Codex",
			baseUrl: "http://127.0.0.1:15721/v1",
			api: "openai-completions",
			authHeader: false,
			models: [
				{
					id: "gpt-5.5",
					name: "gpt-5.5",
				},
			],
			compat: {
				supportsDeveloperRole: true,
				supportsUsageInStreaming: true,
				thinkingFormat: "openai",
			},
		},
	},
};

const seedTactics = [
	{
		id: "answer-directly-under-pressure",
		name: "Answer directly under pressure",
		keywords: [
			"直接",
			"别废话",
			"简短",
			"快点",
			"先给结论",
			"just do it",
			"short",
		],
		emotionRules: [
			{ key: "stress", operator: ">=", value: 60 },
			{ key: "energy", operator: "<=", value: 45 },
		],
		blockedKeywords: [
			"详细",
			"解释",
			"为什么",
			"展开",
			"细说",
			"detail",
			"explain",
		],
		instruction:
			"Keep the answer short and immediately actionable when the user appears impatient.\nLead with the direct answer or completed action.\nUse short paragraphs.\nOnly include necessary caveats.\nAvoid: Do not restate obvious context.\nAvoid: Do not add exploratory alternatives unless asked.\nOne direct sentence, followed by concise bullets only when useful.",
	},
	{
		id: "recover-after-correction",
		name: "Recover after correction",
		keywords: [
			"不是",
			"不对",
			"我说的是",
			"你理解错了",
			"别",
			"wrong",
			"no, I mean",
		],
		emotionRules: [{ key: "stress", operator: ">=", value: 55 }],
		blockedKeywords: ["新问题", "另一个", "unrelated"],
		instruction:
			"Acknowledge the corrected scope and rebase immediately.\nTreat the latest user message as authoritative.\nState the corrected interpretation briefly.\nProceed with the new scope.\nAvoid: Do not defend the previous interpretation.\nAvoid: Do not continue the old plan.\nBrief correction acknowledgement, then action.",
	},
	{
		id: "explain-tradeoffs-when-uncertain",
		name: "Explain tradeoffs when uncertain",
		keywords: [
			"设计",
			"不完善",
			"好吗",
			"合理",
			"tradeoff",
			"design",
			"should",
		],
		emotionRules: [
			{ key: "trust", operator: "<=", value: 45 },
			{ key: "openness", operator: ">=", value: 50 },
		],
		blockedKeywords: ["做", "改", "直接实现", "不用讨论", "implement"],
		instruction:
			"Surface concrete design gaps and tradeoffs before implementation.\nSeparate must-have gaps from later enhancements.\nExplain why each gap matters.\nKeep recommendations operational.\nAvoid: Do not turn the answer into a broad essay.\nAvoid: Do not invent requirements outside the user's scope.\nShort verdict, then prioritized issues.",
	},
];

const seedStates = [
	{
		id: "trust",
		name: "Trust",
		description: "How much the user currently trusts Violoop's judgment.",
		defaultValue: 45,
	},
	{
		id: "stress",
		name: "Stress",
		description: "How much pressure or irritation the user appears to feel.",
		defaultValue: 20,
	},
	{
		id: "openness",
		name: "Openness",
		description: "How willing the user is to discuss alternatives or nuance.",
		defaultValue: 55,
	},
	{
		id: "energy",
		name: "Energy",
		description: "How much bandwidth the user seems to have for detail.",
		defaultValue: 50,
	},
];

await mkdir(dataDir, { recursive: true });
await seedJson(settingsPath, defaultSettings);
await seedJson(tacticsPath, seedTactics);
await seedJson(statesPath, seedStates);

async function seedJson(path: string, value: unknown) {
	if (!force && (await exists(path))) {
		console.log(`skip ${path}`);
		return;
	}

	await mkdir(dirname(path), { recursive: true });
	const tempPath = `${path}.tmp`;
	await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	await rename(tempPath, path);
	console.log(`${force ? "write" : "seed"} ${path}`);
}

async function exists(path: string) {
	try {
		await readFile(path, "utf8");
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return false;
		}
		throw error;
	}
}
