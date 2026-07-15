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
			errorMessage: (status, payload) => {
				const error =
					typeof payload?.error === "string" ? payload.error : undefined;
				const detail =
					typeof payload?.detail === "string" && payload.detail.trim()
						? payload.detail.trim()
						: undefined;
				if (error && detail && detail !== error) {
					return `${error}\n${detail}`;
				}
				return error ?? detail ?? `Provider test failed with ${status}`;
			},
		},
	);
}
