import { describe, expect, it } from "vitest";
import { applyEmbeddedAttemptToolsAllow } from "../embedded-agent-runner/run/attempt-tool-construction-plan.js";
import { createCalculatorTool } from "./calculator-tool.js";

describe("calculator production adapter", () => {
  it("returns an exact equation and lossless integer evidence", async () => {
    const result = await createCalculatorTool().execute("product", {
      expression: " 12345678901234567890 * 2 ",
    });
    expect(result.content).toEqual([
      { type: "text", text: "12345678901234567890 * 2 = 24691357802469135780" },
    ]);
    expect(result.details).toMatchObject({
      success: true,
      expression: "12345678901234567890 * 2",
      result: "24691357802469135780",
      exact: true,
    });
    expect(JSON.stringify(result.details)).toContain("24691357802469135780");
  });
  it("discloses floating-point precision even for integral division", async () => {
    const result = await createCalculatorTool().execute("division", { expression: "847 / 7" });
    expect(result.content).toEqual([
      { type: "text", text: "847 / 7 = 121 (floating-point; 15 significant digits)" },
    ]);
    expect(result.details).toMatchObject({ success: true, result: "121", exact: false });
  });
  it.each([undefined, {}, { expression: 42 }, { expression: " " }])(
    "rejects missing input %j with source error identity",
    async (input) => {
      const result = await createCalculatorTool().execute("missing", input);
      expect(result.details).toMatchObject({
        success: false,
        error: "CALCULATE_MISSING_EXPRESSION",
      });
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("requires"),
      });
    },
  );
  it.each(["process.exit()", "5 / 0", "2 ^ 20000", "3 +", "1".repeat(10_001)])(
    "rejects invalid or oversized expression without guessed result",
    async (expression) => {
      const result = await createCalculatorTool().execute("invalid", { expression });
      expect(result.details).toMatchObject({
        success: false,
        expression,
        error: "CALCULATE_INVALID_EXPRESSION",
        reason: expect.any(String),
      });
      expect(result.details).not.toHaveProperty("result");
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("could not evaluate"),
      });
    },
  );
  it("honors cancellation before evaluation", async () => {
    const controller = new AbortController();
    controller.abort(new Error("calculator cancelled"));
    await expect(
      createCalculatorTool().execute("cancelled", { expression: "2 + 2" }, controller.signal),
    ).rejects.toThrow("calculator cancelled");
  });
  it("executes after real existing allowlist filtering", async () => {
    const tool = createCalculatorTool();
    expect(applyEmbeddedAttemptToolsAllow([tool], [])).toEqual([]);
    const selected = applyEmbeddedAttemptToolsAllow([tool], ["calculate"]);
    expect(selected).toHaveLength(1);
    expect(
      (await selected[0].execute("allowed", { expression: "3847 * 292" })).details,
    ).toMatchObject({ result: "1123324", exact: true });
  });
});
