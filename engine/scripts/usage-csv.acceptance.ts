// Source cases: openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3
// ui/src/pages/usage/query.test.ts. Runtime assertions use Node's test runner.
import assert from "node:assert/strict";
import { describe, it as nodeIt } from "node:test";
import { buildDailyCsv, buildSessionsCsv } from "../src/shared/usage-csv.js";
import type { SessionUsageEntry as UsageSessionEntry } from "../src/shared/usage-types.js";

const it = Object.assign(nodeIt, {
  each: (cases: [string, string, string][]) => (name: string, check: (...values: [string, string, string]) => void) => {
    for (const values of cases) nodeIt(name.replace("%s", values[0] ?? ""), () => check(...values));
  },
});
function expect(value: string) {
  return {
    toBe: (expected: string) => assert.equal(value, expected),
    toContain: (expected: string) => assert(value.includes(expected), `Expected CSV to contain ${JSON.stringify(expected)}`),
  };
}

describe("usage query CSV export", () => {
  it("keeps daily headers aligned with numeric cells", () => {
    expect(
      buildDailyCsv([
        {
          date: "2026-09-23",
          input: 1,
          output: 2,
          cacheRead: 3,
          cacheWrite: 4,
          totalTokens: 10,
          inputCost: 0,
          outputCost: -2,
          cacheReadCost: 3,
          cacheWriteCost: 4,
          totalCost: -2,
          missingCostEntries: 2,
        },
      ]),
    ).toBe(
      "date,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens,inputCost,outputCost,cacheReadCost,cacheWriteCost,totalCost\n" +
        "2026-09-23,1,2,3,4,10,0,-2,3,4,-2",
    );
  });

  it("omits invalid session updated timestamps instead of throwing", () => {
    const csv = buildSessionsCsv([
      {
        key: "session-1",
        label: "Session 1",
        updatedAt: Number.POSITIVE_INFINITY,
        usage: null,
      } satisfies UsageSessionEntry,
    ]);

    expect(csv).toContain("session-1,Session 1,,,,,,,,,,,,,,,");
  });

  it.each([
    ["equals", "=1+1", "'=1+1"],
    ["plus", "+1+1", "'+1+1"],
    ["minus", "-1+1", "'-1+1"],
    ["at", "@SUM(A1:A2)", "'@SUM(A1:A2)"],
    ["leading whitespace", " \t=1+1", "' \t=1+1"],
    ["fullwidth equals", "\uFF1D1+1", "'\uFF1D1+1"],
    ["fullwidth plus", "\uFF0B1+1", "'\uFF0B1+1"],
    ["fullwidth minus", "\uFF0D1+1", "'\uFF0D1+1"],
    ["fullwidth at", "\uFF20SUM(A1:A2)", "'\uFF20SUM(A1:A2)"],
  ])("neutralizes spreadsheet formula labels with %s prefix", (_name, label, expected) => {
    const csv = buildSessionsCsv([
      {
        key: "session-1",
        label,
        updatedAt: 0,
        usage: null,
      } satisfies UsageSessionEntry,
    ]);

    expect(csv).toContain(`session-1,${expected},`);
  });

  it("quotes carriage returns in formula-neutralized labels", () => {
    const csv = buildSessionsCsv([
      {
        key: "session-1",
        label: "\r=1+1",
        updatedAt: 0,
        usage: null,
      } satisfies UsageSessionEntry,
    ]);

    expect(csv).toContain('session-1,"\'\r=1+1",');
  });

  it.each([
    ["tab", "\tplain", "\tplain"],
    ["carriage return", "\rplain", '"\rplain"'],
    ["newline", "\nplain", '"\nplain"'],
  ])("preserves benign labels with leading %s", (_name, label, expected) => {
    const csv = buildSessionsCsv([
      {
        key: "session-1",
        label,
        updatedAt: 0,
        usage: null,
      } satisfies UsageSessionEntry,
    ]);

    expect(csv).toContain(`session-1,${expected},`);
  });

  it("keeps numeric cells numeric while neutralizing string labels", () => {
    const csv = buildSessionsCsv([
      {
        key: "session-1",
        label: "-remote-label",
        updatedAt: 0,
        usage: {
          durationMs: -1,
          messageCounts: {
            total: -2,
            user: -3,
            assistant: -4,
            toolCalls: -5,
            toolResults: -6,
            errors: -7,
          },
          input: -5,
          output: -6,
          cacheRead: -7,
          cacheWrite: -8,
          totalTokens: -9,
          totalCost: -10,
          inputCost: -11,
          outputCost: -12,
          cacheReadCost: -13,
          cacheWriteCost: -14,
          missingCostEntries: -15,
        },
      } satisfies UsageSessionEntry,
    ]);

    expect(csv).toContain("session-1,'-remote-label,,,");
    expect(csv).toContain(",-1,-2,-7,-5,-5,-6,-7,-8,-9,-10");
  });
});
