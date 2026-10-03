import { describe, expect, it } from "vitest";
import { readBoard } from "./DashboardTab";

describe("Dashboard tab: board.get", () => {
  it("orders tabs and widgets and names each widget's kind", () => {
    const b = readBoard({
      sessionKey: "k",
      revision: 3,
      tabs: [{ tabId: "money", title: "Money", position: 1, chatDock: "right" }, { tabId: "main", title: "Main", position: 0, chatDock: "right" }],
      widgets: [
        { name: "b", tabId: "main", contentKind: "plugin", kindLabel: "Chart", sizeW: 6, sizeH: 4, position: 1, grantState: "none", revision: 1 },
        { name: "a", tabId: "main", title: "Status", contentKind: "html", sizeW: 20, sizeH: 2, position: 0, grantState: "pending", revision: 1 },
      ],
    });
    expect(b.tabs.map((t) => t.tabId)).toEqual(["main", "money"]);
    expect(b.widgets.map((w) => [w.title, w.kind, w.w, w.pending])).toEqual([["Status", "Widget", 12, true], ["b", "Chart", 6, false]]);
  });
  it("reads an empty board", () => {
    expect(readBoard({ sessionKey: "k", revision: 0, tabs: [], widgets: [] })).toEqual({ tabs: [], widgets: [] });
  });
});
