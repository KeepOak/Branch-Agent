/** Six unchanged arithmetic cases copied from pinned Eliza calculate.test.ts. */
import { describe, expect, it } from "vitest";
import { evaluateArithmetic } from "./arithmetic.js";

describe("evaluateArithmetic", () => {
  it("computes the live-incident product exactly", () => {
    // 2026-08-24: the model produced 1,123,186 / 1,122,824 for this ask.
    expect(evaluateArithmetic("3847 * 292")).toEqual({
      text: "1123324",
      exact: true,
    });
  });

  it("honors precedence, parentheses, and unary minus", () => {
    expect(evaluateArithmetic("2 + 3 * 4").text).toBe("14");
    expect(evaluateArithmetic("(2 + 3) * 4").text).toBe("20");
    expect(evaluateArithmetic("-5 + 3").text).toBe("-2");
    expect(evaluateArithmetic("2 ^ 10").text).toBe("1024");
    expect(evaluateArithmetic("2 ** 10").text).toBe("1024");
    expect(evaluateArithmetic("-2 ^ 2").text).toBe("-4");
    expect(evaluateArithmetic("(-2) ^ 2").text).toBe("4");
    expect(evaluateArithmetic("2 ^ -2")).toEqual({
      text: "0.25",
      exact: false,
    });
    expect(evaluateArithmetic("10 % 3").text).toBe("1");
  });

  it("is exact beyond float precision in the integer lane", () => {
    expect(evaluateArithmetic("12345678901234567890 * 2")).toEqual({
      text: "24691357802469135780",
      exact: true,
    });
    const power = evaluateArithmetic("10 ^ 5001");
    expect(power.exact).toBe(true);
    expect(power.text).toHaveLength(5002);
    expect(power.text).toMatch(/^10+$/);
  });

  it("accepts digit separators", () => {
    expect(evaluateArithmetic("1,234 * 1_000").text).toBe("1234000");
  });

  it("division and decimals use the disclosed float lane", () => {
    const r = evaluateArithmetic("847 / 7");
    expect(r).toEqual({ text: "121", exact: false });
    expect(evaluateArithmetic("0.1 + 0.2").text).toBe("0.3");
  });

  it("rejects invalid input and oversized work before returning a partial result", () => {
    for (const bad of [
      "two plus two",
      "x * 3",
      "1,,2 + 3",
      "5 / 0",
      "2 ^ 20000",
      "99 ^ 10000",
      "3 +",
      "1".repeat(10_001),
      `${"(".repeat(300)}1${")".repeat(300)}`,
      `${"-".repeat(300)}1`,
    ]) {
      expect(() => evaluateArithmetic(bad)).toThrow();
    }
  });
});
