import { vi } from "vitest";
import type {
	StateDefinition,
	Tactic,
	VioloopConfig,
} from "../../src/shared/types";
import { createVioloopConfig } from "../fixtures/config";
import { createStateDefinition, createTactic } from "../fixtures/session";

export const localSeedConfig: VioloopConfig = createVioloopConfig();

export const localSeedTactic: Tactic = createTactic();

export const localSeedState: StateDefinition = createStateDefinition({
	id: "trust",
	name: "Trust",
	defaultValue: 50,
});

export function stubLocalSeedFetch(
	config: VioloopConfig = localSeedConfig,
	tactic: Tactic = localSeedTactic,
	state: StateDefinition = localSeedState,
) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith("settings.json"))
				return new Response(JSON.stringify(config), { status: 200 });
			if (url.endsWith("tactics.json"))
				return new Response(JSON.stringify([tactic]), { status: 200 });
			if (url.endsWith("states.json"))
				return new Response(JSON.stringify([state]), { status: 200 });
			if (url.endsWith("/api/chat"))
				return new Response(
					JSON.stringify({
						text: JSON.stringify({
							messages: [{ kind: "chat", content: "Local answer" }],
						}),
						usage: { promptTokens: 2 },
					}),
					{ status: 200 },
				);
			return new Response("not found", { status: 404 });
		}),
	);
}
