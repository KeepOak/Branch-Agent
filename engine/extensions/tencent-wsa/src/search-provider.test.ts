import { describe, expect, it } from "vitest";
import { buildTencentWsaRequest, coerceTencentWsaCount } from "./client.js";

describe("pinned Tencent donor options", () => {
  it.each([undefined, null, true, false, 0, -1, 1.5, "-5", "5.5", "bad"])(
    "defaults invalid count %s to 5",
    (value) => {
      expect(coerceTencentWsaCount(value)).toBe(5);
    },
  );
  it.each([
    [" 12 ", 12],
    [1, 1],
    [50, 50],
    [51, 50],
    [1000, 50],
    ["0003", 3],
  ] as const)("coerces %s to %s", (value, expected) => {
    expect(coerceTencentWsaCount(value)).toBe(expected);
  });
  it.each([
    [5, undefined],
    [10, undefined],
    [11, 20],
    [20, 20],
    [21, 30],
    [50, 50],
  ] as const)("preserves Tencent Cnt support for %s", (count, expected) => {
    expect(buildTencentWsaRequest("q", count, undefined)).toEqual({
      Query: "q",
      ...(expected === undefined ? {} : { Cnt: expected }),
    });
  });
  it.each([undefined, null, true, "1", 3, -1, 0.5])(
    "omits invalid or unspecified Mode %s",
    (mode) => {
      expect(buildTencentWsaRequest("q", 5, mode)).toEqual({ Query: "q" });
    },
  );
  it.each([0, 1, 2])("preserves explicit Mode %s", (mode) => {
    expect(buildTencentWsaRequest("q", 5, mode)).toEqual({ Query: "q", Mode: mode });
  });
});
