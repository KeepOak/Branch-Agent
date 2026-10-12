import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";

const writeWizardConfigFile = vi.hoisted(() => vi.fn());

vi.mock("../../wizard/setup.shared.js", () => ({ writeWizardConfigFile }));

import { commitNonInteractiveOnboardConfig } from "./config-write.js";

describe("commitNonInteractiveOnboardConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeWizardConfigFile.mockImplementation(async (config: BranchConfig) => ({
      path: "/tmp/branch.json",
      nextConfig: config,
    }));
  });

  it("keeps the verified config hash on the canonical writer", async () => {
    const nextConfig: BranchConfig = {
      gateway: { port: 19_001 },
    };

    await expect(
      commitNonInteractiveOnboardConfig({
        nextConfig,
        baseConfig: {},
        baseHash: "verified-config-hash",
      }),
    ).resolves.toBe(nextConfig);

    expect(writeWizardConfigFile).toHaveBeenCalledWith(nextConfig, {
      allowConfigSizeDrop: false,
      mergeBase: {},
      baseHash: "verified-config-hash",
    });
  });

  it("permits config size reduction only for an explicitly requested reset", async () => {
    const nextConfig: BranchConfig = {};

    await commitNonInteractiveOnboardConfig({
      nextConfig,
      baseConfig: {},
      reset: true,
    });

    expect(writeWizardConfigFile).toHaveBeenCalledWith(nextConfig, {
      allowConfigSizeDrop: true,
      mergeBase: {},
    });
  });
});
