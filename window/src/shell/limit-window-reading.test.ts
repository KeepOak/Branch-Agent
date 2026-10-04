import { describe, expect, it } from "vitest";
import { readLimits, ringReading } from "./status-data";

const snapshot = (windows: unknown[]) => ({ updatedAt: 123, providers: [{ provider: "test-provider", windows }] });

describe("quota measurement before public presentation", () => {
  it.each([undefined, null, "0", false, NaN, Infinity, -Infinity])("does not turn %s into a measured full quota", (usedPercent) => {
    const result = readLimits(snapshot([{ label: "5h", usedPercent }]), 456);
    expect(result.rows[0].windows).toEqual([]);
    expect(result.rows[0].pill).toBe("Not published");
    expect(ringReading(result)).toBeNull();
  });

  it.each([[0, 100], [25, 75], [100, 0], [-1, 100], [101, 0]])("preserves measured percent %s as %s left", (usedPercent, left) => {
    const result = readLimits(snapshot([{ label: "5h", usedPercent }]), 456);
    expect(result.rows[0].pill).toBe("Measured");
    expect(result.rows[0].windows[0].left).toBe(left);
  });

  it("uses only valid measured windows when choosing the public quota ring", () => {
    const result = readLimits(snapshot([{ label: "5h" }, { label: "Week", usedPercent: 75 }]), 456);
    expect(result.rows[0].windows).toEqual([{ name: "This week", left: 25, reset: "", low: false }]);
    expect(ringReading(result)?.left).toBe(25);
  });

  it("keeps missing windows and account errors informational rather than full", () => {
    const result = readLimits({ providers: [{ provider: "test-provider", error: "Usage not reported" }] }, 456);
    expect(result.rows[0]).toMatchObject({ pill: "Not published", line: "Usage not reported", windows: [] });
    expect(ringReading(result)).toBeNull();
  });
});
