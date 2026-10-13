import { describe, expect, it } from "vitest";
import { arc, ringColour } from "../../glass/Ring";
import { contextUse, ringSummary, tightest, tokenWords } from "./usage";
import type { Limits } from "../../shell/status-data";

const limits = (rows: { name: string; windows: { name: string; left: number; reset?: string }[] }[]): Limits => ({
  updatedAt: 0, refreshing: false,
  rows: rows.map((r, i) => ({ id: String(i), name: r.name, account: "", pill: "Measured", line: "", windows: r.windows.map((w) => ({ name: w.name, left: w.left, reset: w.reset ?? "", low: false })) })),
});

describe("R1 composer ring", () => {
  it("takes the tightest 5-hour or weekly window across every account", () => {
    const t = tightest(limits([
      { name: "ChatGPT · Account 1", windows: [{ name: "5-hour", left: 77, reset: "resets in 2 h" }, { name: "Week", left: 59 }] },
      { name: "ChatGPT · Account 2", windows: [{ name: "5-hour", left: 61 }, { name: "Week", left: 30 }] },
    ]));
    expect(t).toEqual({ percent: 70, name: "ChatGPT · Account 2", when: "this week" });
  });
  it("reports nothing when no account has a reading, and never invents a number", () => {
    expect(tightest(null)).toBeNull();
    expect(tightest(limits([{ name: "Claude · Account 1", windows: [] }]))).toBeNull();
    expect(contextUse(0, 256000)).toBeNull();
    expect(ringSummary(null, 0, null)).toBe("Usage not reported yet · nothing running · context not measured yet");
  });
  it("words context the way the preview does", () => {
    expect(contextUse(36000, 256000)).toEqual({ percent: 14, line: "36k / 256k (14%)" });
    expect(tokenWords(1_000_000)).toBe("1M");
    expect(ringSummary({ percent: 70, name: "ChatGPT · Account 2", when: "this week" }, 4, contextUse(36000, 256000)))
      .toBe("Usage 70% (ChatGPT · Account 2, this week) · 4 running · context 36k / 256k (14%)");
  });
  it("colours arcs at 80 and 95 percent and keeps a 2% minimum arc", () => {
    expect(ringColour(79)).toBe("currentColor");
    expect(ringColour(80)).toBe("var(--warn)");
    expect(ringColour(95)).toBe("var(--bad)");
    expect(arc(10, 0)).toBe("1.3 62.8");
    expect(arc(10, 70)).toBe("44.0 62.8");
  });
});
