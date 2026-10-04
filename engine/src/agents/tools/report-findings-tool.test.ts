import { randomUUID } from "node:crypto";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import type { ReportFindingsFindingParams } from "../../coding/report-findings.js";
import { createReportFindingsTool } from "./report-findings-tool.js";

function finding(
  overrides: Partial<ReportFindingsFindingParams> = {},
): ReportFindingsFindingParams {
  return {
    id: "R1-1",
    severity: "Critical",
    file: "src/cache.ts",
    line: 42,
    summary: "Cold cache returns undefined",
    failureScenario: "The first request after startup receives an undefined response.",
    ...overrides,
  };
}

describe("report_findings production tool", () => {
  it("delivers typed records and concrete locations through the native tool contract", async () => {
    const tool = createReportFindingsTool();
    const input = {
      level: "high" as const,
      findings: [finding({ direction: "certifies-falsely", baseline: "regression" })],
    };
    expect(Value.Check(tool.parameters, input)).toBe(true);
    const result = await tool.execute("report", input);
    expect(Value.Check(tool.outputSchema!, result.details)).toBe(true);
    expect(result.details).toMatchObject({
      type: "findings_list",
      level: "high",
      findings: [
        finding({
          shortSummary: "Cold cache returns undefined",
          direction: "certifies-falsely",
          baseline: "regression",
        }),
      ],
    });
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("1 Critical"),
    });
    expect(result.content[1]).toMatchObject({
      type: "text",
      text: expect.stringContaining('"file": "src/cache.ts"'),
    });
    expect(tool.catalogMode).toBe("direct-only");
  });

  it("preserves complete outcome identity when the live session tool is recreated", async () => {
    const sessionKey = randomUUID();
    await createReportFindingsTool({ sessionKey }).execute("first", {
      findings: [finding(), finding({ id: "R1-2", file: "src/second.ts" })],
    });
    const nextTurn = createReportFindingsTool({ sessionKey });
    await expect(
      nextTurn.execute("partial", { findings: [finding({ outcome: "fixed" })] }),
    ).rejects.toThrow(/drops 1 finding/);
    const result = await nextTurn.execute("complete", {
      findings: [
        finding({ outcome: "fixed" }),
        finding({
          id: "R1-2",
          file: "src/second.ts",
          outcome: "skipped",
          outcomeNote: "The current behavior is required by the documented API.",
        }),
      ],
    });
    expect(result.details?.findings).toHaveLength(2);
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining("1 fixed, 1 skipped"),
    });
  });

  it("keeps unrelated live sessions and uncached cold instances independent", async () => {
    await createReportFindingsTool({ sessionKey: randomUUID() }).execute("first", {
      findings: [finding(), finding({ id: "R1-2" })],
    });
    const result = await createReportFindingsTool({ sessionKey: randomUUID() }).execute("other", {
      findings: [finding({ outcome: "fixed" })],
    });
    expect(result.details?.findings).toHaveLength(1);
    const cold = await createReportFindingsTool().execute("cold", {
      findings: [finding({ outcome: "fixed" })],
    });
    expect(cold.details?.findings[0]?.outcome).toBe("fixed");
  });

  it("does not replace delivered identity when an aborted report is discarded", async () => {
    const sessionKey = randomUUID();
    const tool = createReportFindingsTool({ sessionKey });
    await tool.execute("first", { findings: [finding()] });
    await expect(
      tool.execute("discarded", { findings: [finding({ id: "R2-1" })] }, AbortSignal.abort()),
    ).rejects.toThrow();
    const result = await createReportFindingsTool({ sessionKey }).execute("outcomes", {
      findings: [finding({ outcome: "fixed" })],
    });
    expect(result.details?.findings[0]?.id).toBe("R1-1");
  });

  it("sorts severity and source locations and retains canonical full prose", async () => {
    const long = "A".repeat(300);
    const result = await createReportFindingsTool().execute("sorted", {
      findings: [
        finding({ id: "R1-3", severity: "Nice to have", file: "a.ts" }),
        finding({ id: "R1-2", confidence: "low", file: "b.ts" }),
        finding({ confidence: "high", summary: long }),
      ],
    });
    expect(result.details?.findings.map((item) => item.id)).toEqual(["R1-1", "R1-2", "R1-3"]);
    expect(result.details?.findings[0]?.summary).toBe(long);
    expect(result.details?.findings[0]?.shortSummary).toHaveLength(60);
  });

  it("refuses malformed, duplicate and incomplete outcome reports at execution", async () => {
    const tool = createReportFindingsTool();
    await expect(tool.execute("duplicate", { findings: [finding(), finding()] })).rejects.toThrow(
      /duplicate id/,
    );
    await expect(
      tool.execute("control", { findings: [finding({ file: "src/file.ts\u0007" })] }),
    ).rejects.toThrow(/control characters/);
    await expect(
      tool.execute("partial", {
        findings: [finding({ outcome: "fixed" }), finding({ id: "R1-2" })],
      }),
    ).rejects.toThrow(/every finding or none/);
    await expect(
      tool.execute("skipped", { findings: [finding({ outcome: "skipped" })] }),
    ).rejects.toThrow(/outcomeNote/);
  });

  it("delivers an empty report as an actual typed replacement", async () => {
    const tool = createReportFindingsTool();
    await tool.execute("first", { findings: [finding()] });
    const result = await tool.execute("empty", { findings: [] });
    expect(result.details).toEqual({ type: "findings_list", findings: [] });
    expect(Value.Check(tool.outputSchema!, result.details)).toBe(true);
    await expect(
      tool.execute("after-clear", { findings: [finding({ id: "R9-1", outcome: "fixed" })] }),
    ).resolves.toBeDefined();
  });
});
