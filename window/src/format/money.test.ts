import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("uses en-US dollars with two decimals regardless of the viewer's locale", () => {
    expect(formatMoney(1286.4)).toBe("$1,286.40");
    expect(formatMoney(0.001)).toBe("$0.00");
    expect(formatMoney(-12.5)).toBe("-$12.50");
  });
});
