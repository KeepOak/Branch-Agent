import type { BranchPluginApi } from "branch/plugin-sdk/plugin-entry";

/** Lists the models the Trunk's ChatGPT account can run, as the Codex app-server reports them. */
export function registerCodexAccountModels(api: BranchPluginApi): void {
  api.registerGatewayMethod(
    "codex.models",
    async (options) => {
      const { handleCodexAccountModels } = await import("./account-models-runtime.js");
      await handleCodexAccountModels(options);
    },
    { scope: "operator.admin" },
  );
}
