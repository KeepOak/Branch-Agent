import type { PluginRuntime } from "branch/plugin-sdk/core";
import { createPluginRuntimeStore } from "branch/plugin-sdk/runtime-store";

const { setRuntime: setLineRuntime, getRuntime: getLineRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "line",
    errorMessage: "LINE runtime not initialized - plugin not registered",
  });
export { getLineRuntime, setLineRuntime };
