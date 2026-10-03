import {
  defineBundledChannelEntry,
  type BranchPluginApi,
} from "branch/plugin-sdk/channel-entry-contract";
import { createLazyRuntimeModule } from "branch/plugin-sdk/lazy-runtime";
import { registerReefCliMetadata } from "./cli-metadata.js";

const loadReefCommandsRuntime = createLazyRuntimeModule(() => import("./commands.runtime.js"));

function registerReefFullRuntime(api: BranchPluginApi): void {
  api.registerCommand({
    name: "reef",
    description: "Manage Reef friends and owner review approvals",
    acceptsArgs: true,
    requireAuth: true,
    exposeSenderIsOwner: true,
    handler: async (params) => {
      const { handleReefCommand } = await loadReefCommandsRuntime();
      return await handleReefCommand(params);
    },
  });
}

export default defineBundledChannelEntry({
  id: "reef",
  name: "Reef",
  description: "Guarded end-to-end encrypted grove channel",
  importMetaUrl: import.meta.url,
  plugin: { specifier: "./channel-plugin-api.js", exportName: "reefPlugin" },
  runtime: { specifier: "./runtime-api.js", exportName: "setReefRuntime" },
  registerCliMetadata: registerReefCliMetadata,
  registerFull: registerReefFullRuntime,
});
