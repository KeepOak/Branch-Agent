import { describe, expect, it } from "vitest";
import { gfxTip, type Vitals } from "./StatusExtras";

const GB = 1024 ** 3;
const vitals = (usedGb: number): Vitals => ({ memUsed: usedGb * GB, memTotal: 16 * GB, cpus: 8, load: null, diskFree: null, diskTotal: null, upMs: null, node: "", pid: null });

describe("gfxTip", () => {
  it("explains a nearly full memory readout and says what to do", () => {
    expect(gfxTip(vitals(15.8), "regular")).toContain("Memory is nearly full (15.8 of 16 GB used): close apps you aren't using to free some.");
  });
  it("keeps the plain tip while memory has room", () => {
    expect(gfxTip(vitals(8), "regular")).toBe("This computer’s graphics card and memory");
    expect(gfxTip(null, "regular")).toBe("This computer’s graphics card and memory");
  });
});
