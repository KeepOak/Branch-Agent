import { describe, expect, it } from "vitest";
import { fitTabs, MORE_TAB_WIDTH, TAB_GAP } from "./tab-fit";

const tabs = ["Activity", "Dashboard", "Preview", "Timeline"];
const widths = { Activity: 70, Dashboard: 84, Preview: 66, Timeline: 74 };
const used = (list: string[]) => list.reduce((s, t) => s + (widths as Record<string, number>)[t]!, 0) + TAB_GAP * Math.max(0, list.length - 1);

describe("fitTabs", () => {
  it("shows every tab when they all fit", () => {
    expect(fitTabs(tabs, widths, 400, "Activity")).toEqual({ visible: tabs, overflow: [] });
  });

  it("moves the tabs that do not fit into More, and what it shows fits with the More button", () => {
    const fit = fitTabs(tabs, widths, 240, "Activity");
    expect(fit.visible).toEqual(["Activity", "Dashboard"]);
    expect(fit.overflow).toEqual(["Preview", "Timeline"]);
    expect(used(fit.visible) + TAB_GAP + MORE_TAB_WIDTH).toBeLessThanOrEqual(240);
  });

  it("keeps the current tab visible even when it is in the overflow", () => {
    const fit = fitTabs(tabs, widths, 240, "Timeline");
    expect(fit.visible).toContain("Timeline");
    expect([...fit.visible, ...fit.overflow].sort()).toEqual([...tabs].sort());
  });

  it("shows every tab until the row has a width, and counts an unmeasured tab as 0", () => {
    expect(fitTabs(tabs, widths, 0, "Activity").overflow).toEqual([]);
    expect(fitTabs(tabs, {}, 10, "Activity").overflow).toEqual([]);
  });
});
