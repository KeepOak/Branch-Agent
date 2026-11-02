import { describe, expect, it } from "vitest";
import { EMPTY_TABS, initialTabs, reduceTabs, tabLabel } from "./guest-tabs";

describe("guest tab reducer", () => {
  it("opens a tab on about:blank and shows it", () => {
    const state = reduceTabs(EMPTY_TABS, { type: "open" });
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({ id: "tab-1", url: "about:blank" });
    expect(state.activeId).toBe("tab-1");
  });

  it("starts with one tab when given an address", () => {
    expect(initialTabs("https://example.com").tabs[0].url).toBe("https://example.com");
    expect(initialTabs().tabs).toHaveLength(0);
  });

  it("updates a tab's page report", () => {
    const opened = reduceTabs(EMPTY_TABS, { type: "open", url: "https://a.test" });
    const state = reduceTabs(opened, { type: "update", id: "tab-1", patch: { title: "A", canGoBack: true } });
    expect(state.tabs[0]).toMatchObject({ title: "A", canGoBack: true, url: "https://a.test" });
  });

  it("moves to the neighbour when the showing tab closes", () => {
    let state = reduceTabs(EMPTY_TABS, { type: "open", url: "https://a.test" });
    state = reduceTabs(state, { type: "open", url: "https://b.test" });
    state = reduceTabs(state, { type: "open", url: "https://c.test" });
    state = reduceTabs(state, { type: "activate", id: "tab-2" });
    state = reduceTabs(state, { type: "close", id: "tab-2" });
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-3"]);
    expect(state.activeId).toBe("tab-3");
  });

  it("shows nothing once the last tab closes", () => {
    const state = reduceTabs(initialTabs("https://a.test"), { type: "close", id: "tab-1" });
    expect(state).toMatchObject({ tabs: [], activeId: null });
  });

  it("ignores activating a tab that is not open", () => {
    const state = initialTabs("https://a.test");
    expect(reduceTabs(state, { type: "activate", id: "tab-9" })).toBe(state);
  });

  it("labels a tab by its title, then its address, then New tab", () => {
    const base = { id: "t", loading: false, canGoBack: false, canGoForward: false };
    expect(tabLabel({ ...base, url: "https://a.test", title: "A" })).toBe("A");
    expect(tabLabel({ ...base, url: "https://a.test", title: "" })).toBe("https://a.test");
    expect(tabLabel({ ...base, url: "about:blank", title: "" })).toBe("New tab");
  });
});
