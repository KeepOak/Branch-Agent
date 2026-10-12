import path from "node:path";
import type { ControlUiMockGatewayScenario } from "./control-ui-e2e.ts";
import type { NativeControlUiPluginFixture } from "./control-ui-plugin-fixture.ts";

const canopyNativePlugins: NativeControlUiPluginFixture[] = [
  {
    pluginId: "canopy",
    rootDir: path.resolve(import.meta.dirname, "../../../extensions/canopy"),
    source: "browser/index.ts",
  },
];

export const canopyUi = {
  nativePlugins: canopyNativePlugins,
  controlUiTabs: [
    {
      pluginId: "canopy",
      id: "canopy",
      label: "Canopy",
      placement: "route:canopy",
      icon: "kanban",
      group: "control",
    },
  ],
} satisfies Pick<ControlUiMockGatewayScenario, "nativePlugins" | "controlUiTabs">;
