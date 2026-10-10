import { describe, expect, it, vi } from "vitest";
import { helpMenuItems } from "./help-menu";

describe("the Help menu", () => {
  it("holds the guide, keyboard shortcuts, docs and contact, plus the page's own help on a Settings page", () => {
    const run = vi.fn();
    const links = [{ label: "Docs", run }, { label: "Get help", run }];
    const base = { walkthrough: run, setup: run, news: run, canDo: run, shortcuts: run, links };
    const labels = (items: ReturnType<typeof helpMenuItems>) => items.map((item) => "label" in item ? item.label : "---");
    expect(labels(helpMenuItems(base))).toEqual(["Take the walkthrough", "Set up Branch", "What’s new", "What Branch can do", "Keyboard shortcuts", "---", "Docs", "Get help"]);
    const pageHelp = vi.fn();
    const settings = helpMenuItems({ ...base, pageHelp });
    expect(labels(settings).slice(0, 2)).toEqual(["Help for this page", "---"]);
    const first = settings[0];
    if (!("run" in first)) throw new Error("Help for this page should run");
    first.run();
    expect(pageHelp).toHaveBeenCalledOnce();
  });
});
