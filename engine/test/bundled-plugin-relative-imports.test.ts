// Release size guard: bundled plugins reach engine code only through branch/plugin-sdk.
import { describe, expect, it } from "vitest";
import { createExtensionPluginSdkBoundaryChecker } from "../scripts/check-extension-plugin-sdk-boundary.mts";

describe("bundled plugin relative imports", () => {
  // A relative import into engine src makes the bundler copy the whole engine graph into that
  // plugin's private .setup chunks (A2A shipped 67 MB of duplicate engine code this way).
  it("import nothing through relative paths outside their own package", async () => {
    const inventory = await createExtensionPluginSdkBoundaryChecker().collectInventory(
      "relative-outside-package",
    );

    expect(inventory).toStrictEqual([]);
  });
});
