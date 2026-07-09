import type {
	ProviderConfig,
	ProviderTestRequest,
	ProviderTestResponse,
} from "../../../../shared/types";
import { fetchJson } from "../../../shared/api";

export async function testProviderConnection(
	input: Required<
		Pick<ProviderTestRequest, "providerId" | "provider" | "model">
	> & {
		provider: ProviderConfig;
	},
) {
	return fetchJson<ProviderTestResponse>(
		"/api/providers/test",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		},
		{
			errorMessage: (status, payload) =>
				typeof payload?.error === "string"
					? payload.error
					: typeof payload?.detail === "string"
						? payload.detail
						: `Provider test failed with ${status}`,
		},
	);
}
