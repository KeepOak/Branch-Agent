import type { PluginRuntime } from "branch/plugin-sdk/core";
import { createPluginRuntimeStore } from "branch/plugin-sdk/runtime-store";

const {
  setRuntime: setSignalRuntime,
  getRuntime: getSignalRuntime,
  tryGetRuntime: getOptionalSignalRuntime,
} = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "signal",
  errorMessage: "Signal runtime not initialized",
});
export { getOptionalSignalRuntime, getSignalRuntime, setSignalRuntime };
