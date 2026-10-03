import { createPluginRuntimeStore } from "branch/plugin-sdk/runtime-store";
import type { PluginRuntime } from "branch/plugin-sdk/runtime-store";

const {
  setRuntime: setMSTeamsRuntime,
  getRuntime: getMSTeamsRuntime,
  tryGetRuntime: getOptionalMSTeamsRuntime,
} = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "msteams",
  errorMessage: "MSTeams runtime not initialized",
});
export { getMSTeamsRuntime, getOptionalMSTeamsRuntime, setMSTeamsRuntime };
