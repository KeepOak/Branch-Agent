import { fileURLToPath } from "node:url";
import { capturePluginRegistration } from "branch/plugin-sdk/plugin-test-runtime";
import { describe, expect, it, vi } from "vitest";

vi.mock("./src/store.js", () => ({
  CanopyStore: { openSqlite: () => ({}) },
}));

import plugin from "./index.js";

describe("Canopy plugin registration", () => {
  it("advertises its native route only while the plugin runtime is active", () => {
    const captured = capturePluginRegistration({
      id: "canopy",
      name: "Canopy",
      register(api) {
        plugin.register({
          ...api,
          runtimeSource: fileURLToPath(new URL("./index.ts", import.meta.url)),
        });
      },
    });

    expect(captured.controlUiDescriptors).toContainEqual({
      surface: "tab",
      id: "canopy",
      label: "Canopy",
      placement: "route:canopy",
      icon: "kanban",
      group: "control",
      requiredScopes: ["operator.read"],
    });
  });
});
