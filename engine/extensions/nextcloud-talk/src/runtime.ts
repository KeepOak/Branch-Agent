import { createPluginRuntimeStore } from "branch/plugin-sdk/runtime-store";
import type { PluginRuntime } from "branch/plugin-sdk/runtime-store";

const {
  setRuntime: setNextcloudTalkRuntime,
  getRuntime: getNextcloudTalkRuntime,
  tryGetRuntime: getOptionalNextcloudTalkRuntime,
} = createPluginRuntimeStore<PluginRuntime>({
  pluginId: "nextcloud-talk",
  errorMessage: "Nextcloud Talk runtime not initialized",
});
export { getNextcloudTalkRuntime, getOptionalNextcloudTalkRuntime, setNextcloudTalkRuntime };
