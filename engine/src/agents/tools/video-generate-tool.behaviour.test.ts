// Written by Branch for MEDIA-0088: DECISIONS.md item 79 and upstream video factory/model-duration behavior; not copied.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { createEmptyPluginMetadataSnapshot } from "../../plugins/plugin-metadata-empty.test-support.js";
import { normalizeVideoGenerationDuration } from "../../video-generation/duration-support.js";
import type { VideoGenerationProvider } from "../../video-generation/types.js";
import { resolveOptionalMediaToolFactoryPlan } from "../branch-tools.media-factory-plan.js";
import * as availability from "./manifest-capability-availability.js";

const configuredVideo: BranchConfig = {
  agents: { defaults: { mediaModels: { video: { primary: "runway/gen4.5" } } } },
};

describe("MEDIA-0088 video generation behavior", () => {
  beforeEach(() => {
    vi.spyOn(availability, "loadCapabilityMetadataSnapshot").mockReturnValue(
      createEmptyPluginMetadataSnapshot(),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("R-2099: stays off before a video service is chosen, even when allowlisted", () => {
    expect(resolveOptionalMediaToolFactoryPlan({ config: {} }).videoGenerate).toBe(false);
    expect(
      resolveOptionalMediaToolFactoryPlan({
        config: { tools: { allow: ["video_generate"] } },
      }).videoGenerate,
    ).toBe(false);
  });

  it("R-0779: enables video generation after choosing a provider/model", () => {
    expect(resolveOptionalMediaToolFactoryPlan({ config: configuredVideo }).videoGenerate).toBe(
      true,
    );
  });

  it("keeps tool denial and plugin disablement effective after choosing a service", () => {
    for (const config of [
      { ...configuredVideo, tools: { deny: ["video_generate"] } },
      { ...configuredVideo, plugins: { enabled: false } },
    ]) {
      expect(resolveOptionalMediaToolFactoryPlan({ config }).videoGenerate).toBe(false);
    }
  });

  it("normalizes duration by model and mode without changing provider capabilities", () => {
    const provider: VideoGenerationProvider = {
      id: "duration-provider",
      capabilities: {
        generate: {
          supportedDurationSeconds: [4, 8],
          supportedDurationSecondsByModel: { "short-model": [2, 4] },
        },
        imageToVideo: { enabled: true, supportedDurationSeconds: [5, 10] },
      },
      generateVideo: vi.fn(),
    };
    const original = structuredClone(provider.capabilities);
    expect(normalizeVideoGenerationDuration({ provider, durationSeconds: 6 })).toBe(8);
    expect(
      normalizeVideoGenerationDuration({ provider, model: "short-model", durationSeconds: 3 }),
    ).toBe(4);
    expect(
      normalizeVideoGenerationDuration({ provider, inputImageCount: 1, durationSeconds: 7 }),
    ).toBe(5);
    expect(provider.capabilities).toEqual(original);
    expect(provider.generateVideo).not.toHaveBeenCalled();
  });
});
