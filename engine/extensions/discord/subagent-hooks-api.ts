import type { BranchPluginApi } from "branch/plugin-sdk/channel-entry-contract";
import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";

const loadDiscordSubagentHooksModule = createLazyRuntimeModule(
  () => import("./src/subagent-hooks.js"),
);
// Subagent hooks live behind a dedicated barrel so the bundled entry can
// register one stable hook wiring path while keeping the handler module lazy.
export function registerDiscordSubagentHooks(api: BranchPluginApi): void {
  api.on("subagent_ended", async (event) => {
    const { handleDiscordSubagentEnded } = await loadDiscordSubagentHooksModule();
    await handleDiscordSubagentEnded(event);
  });
  api.on("subagent_delivery_target", async (event) => {
    const { handleDiscordSubagentDeliveryTargetAsync } = await loadDiscordSubagentHooksModule();
    return await handleDiscordSubagentDeliveryTargetAsync(event);
  });
}
