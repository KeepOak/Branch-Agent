import { describe, expect, it } from "vitest";
import type { LlamaCppHardware } from "./hardware.js";
import { recommendLlamaCppModel, resolveLlamaCppModelCandidates } from "./model-catalog.js";
import { LLAMA_CPP_SKIP_REASONS } from "./skip-reasons.js";

const GIB = 1024 ** 3;

function mac(totalGiB: number, availableGiB: number): LlamaCppHardware {
  return {
    platform: "darwin",
    arch: "arm64",
    totalMemoryBytes: totalGiB * GIB,
    availableMemoryBytes: availableGiB * GIB,
    availableDiskBytes: 100 * GIB,
    availableRuntimeDiskBytes: 100 * GIB,
    sharedDisk: true,
    accelerator: { kind: "metal" },
  };
}

// The real model list, read through a host big enough to list every model.
const LISTED = resolveLlamaCppModelCandidates(mac(1024, 1024), "metal").recipes;
const SMALLEST_SYSTEM_GIB = Math.min(...LISTED.map((r) => r.minimumSystemMemoryBytes)) / GIB;

describe("free model memory check uses the model list limits", () => {
  it("has models listed for 8 GiB and 16 GiB computers", () => {
    const tiers = new Set(LISTED.map((r) => r.minimumSystemMemoryBytes / GIB));
    expect(tiers).toContain(8);
    expect(tiers).toContain(16);
  });

  it.each([
    { totalGiB: 16, availableGiB: 4 },
    { totalGiB: 16, availableGiB: 1 },
    { totalGiB: 8, availableGiB: 3 },
    { totalGiB: 8, availableGiB: 1 },
  ])(
    "offers a listed free model on a $totalGiB GiB Mac with $availableGiB GiB free right now",
    ({ totalGiB, availableGiB }) => {
      const result = recommendLlamaCppModel(mac(totalGiB, availableGiB), "metal");
      if (result.kind !== "recommended") {
        throw new Error("skipped: " + result.plainReason + " " + result.reason);
      }
      expect(LISTED.map((r) => r.model.id)).toContain(result.recipe.model.id);
      expect(result.recipe.minimumSystemMemoryBytes).toBeLessThanOrEqual(totalGiB * GIB);
    },
  );

  it("still picks the bigger listed model on an idle 16 GiB Mac", () => {
    const result = recommendLlamaCppModel(mac(16, 14), "metal");
    expect(result).toMatchObject({ kind: "recommended" });
    if (result.kind === "recommended") {
      expect(result.recipe.minimumSystemMemoryBytes).toBe(16 * GIB);
    }
  });

  it("never skips for memory when a listed model is meant for this computer", () => {
    for (const recipe of LISTED) {
      const totalGiB = recipe.minimumSystemMemoryBytes / GIB;
      const result = recommendLlamaCppModel(mac(totalGiB, 0.5), "metal");
      expect(result.kind, totalGiB + " GiB").toBe("recommended");
    }
  });

  it("skips for memory only below the smallest listed model, and says so", () => {
    const result = recommendLlamaCppModel(
      mac(SMALLEST_SYSTEM_GIB / 2, SMALLEST_SYSTEM_GIB / 2),
      "metal",
    );
    expect(result).toMatchObject({
      kind: "unavailable",
      plainReason: LLAMA_CPP_SKIP_REASONS.memory,
    });
    expect(LLAMA_CPP_SKIP_REASONS.memory).toMatch(/none of the free models/iu);
    if (result.kind === "unavailable") {
      expect(result.reason).toContain(SMALLEST_SYSTEM_GIB + " GiB");
    }
  });
});
