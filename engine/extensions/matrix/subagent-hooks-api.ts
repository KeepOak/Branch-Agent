// Matrix API module exposes the plugin public contract.
import type { BranchPluginApi } from "branch/plugin-sdk/channel-entry-contract";
import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";

const loadMatrixSubagentHooksModule = createLazyRuntimeModule(
  () => import("./src/matrix/subagent-hooks.js"),
);

export function registerMatrixSubagentHooks(api: BranchPluginApi): void {
  api.on("subagent_ended", async (event) => {
    const { handleMatrixSubagentEnded } = await loadMatrixSubagentHooksModule();
    await handleMatrixSubagentEnded(event);
  });
  api.on("subagent_delivery_target", async (event) => {
    const { handleMatrixSubagentDeliveryTarget } = await loadMatrixSubagentHooksModule();
    return handleMatrixSubagentDeliveryTarget(event);
  });
}
