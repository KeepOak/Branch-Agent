import { createPluginRuntimeStore } from "branch/plugin-sdk/runtime-store";
import type { PluginRuntime } from "branch/plugin-sdk/runtime-store";

const { setRuntime: setQaChannelRuntime, getRuntime: getQaChannelRuntime } =
  createPluginRuntimeStore<PluginRuntime>({
    pluginId: "qa-channel",
    errorMessage: "QA channel runtime not initialized",
  });

export { getQaChannelRuntime, setQaChannelRuntime };
