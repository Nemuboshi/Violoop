import type {
	ProviderConfig,
	ProviderTestRequest,
} from "../../../../shared/types";
import { testAgentProvider } from "../../../shared/api";

export async function testProviderConnection(
	input: Required<
		Pick<ProviderTestRequest, "providerId" | "provider" | "model">
	> & {
		provider: ProviderConfig;
	},
) {
	return testAgentProvider(input);
}
