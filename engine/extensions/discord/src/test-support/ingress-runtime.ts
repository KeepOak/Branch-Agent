import { createPluginRuntimeMock } from "branch/plugin-sdk/channel-test-helpers";
import { beforeEach } from "vitest";
import { setDiscordRuntime } from "../runtime.js";

export function installDiscordIngressTestRuntime() {
  beforeEach(() => {
    setDiscordRuntime(createPluginRuntimeMock());
  });
}
