// Openai tests cover provider runtime.contract plugin behavior.
import { describeOpenAIProviderRuntimeContract } from "branch/plugin-sdk/provider-test-contracts";
import manifest from "./branch.plugin.json" with { type: "json" };

describeOpenAIProviderRuntimeContract(
  () => import("./index.js"),
  manifest.modelCatalog.providers.openai,
);
