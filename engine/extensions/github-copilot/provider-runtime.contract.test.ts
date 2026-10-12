// Github Copilot tests cover provider runtime.contract plugin behavior.
import { describeGithubCopilotProviderRuntimeContract } from "branch/plugin-sdk/provider-test-contracts";
import manifest from "./branch.plugin.json" with { type: "json" };

describeGithubCopilotProviderRuntimeContract(
  () => import("./index.js"),
  manifest.modelCatalog.providers["github-copilot"],
);
