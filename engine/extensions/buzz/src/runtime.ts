import { createPluginRuntimeStore, type PluginRuntime } from "branch/plugin-sdk/runtime-store";

const { setRuntime: setBuzzRuntime, getRuntime: getBuzzRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "buzz",
    errorMessage: "Buzz runtime not initialized",
  });

export { getBuzzRuntime, setBuzzRuntime };
