import type { PluginRuntime } from "branch/plugin-sdk/core";
import { createPluginRuntimeStore } from "branch/plugin-sdk/runtime-store";

const { setRuntime: setZaloRuntime, getRuntime: getZaloRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "zalo",
    errorMessage: "Zalo runtime not initialized",
  });
export { getZaloRuntime, setZaloRuntime };
