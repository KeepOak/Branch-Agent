// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { r1DefaultTopicLayout, r1LayoutOf, r1TopicLayoutFor, r1TopicLayoutNames, readTopicSettings, setR1ContactTopicLayout, setR1TopicLayout, TOPIC_LAYOUT_KEY } from "./topic-layout";

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

const save = (value: unknown) => localStorage.setItem(TOPIC_LAYOUT_KEY, JSON.stringify(value));

describe("R1 thread layouts (owner item 47)", () => {
  it("offers only Tabs above the chat and Freedom Mode", () => {
    expect(Object.keys(r1TopicLayoutNames)).toEqual(["tabs", "free"]);
    expect(r1TopicLayoutNames.free).toBe("Freedom Mode");
  });

  it("defaults to Tabs above the chat when nothing is saved", () => {
    expect(r1DefaultTopicLayout()).toBe("tabs");
    expect(r1TopicLayoutFor("trunk:oak")).toBe("tabs");
  });

  it("keeps a saved Freedom Mode, and maps every removed or damaged saved layout to Tabs", () => {
    save({ layout: "free", width: 0, per: {} });
    expect(r1DefaultTopicLayout()).toBe("free");
    expect(r1TopicLayoutFor("trunk:oak")).toBe("free");
    for (const layout of ["column", "rail", "side", "unknown", null, 7]) {
      save({ layout, width: 300, per: { "trunk:oak": layout } });
      expect(r1DefaultTopicLayout()).toBe("tabs");
      expect(r1TopicLayoutFor("trunk:oak")).toBe("tabs");
    }
    expect(r1LayoutOf("column")).toBe("tabs");
    expect(r1LayoutOf("free")).toBe("free");
  });

  it("keeps Classic's reader unchanged, so Classic still reads its own four layouts", () => {
    save({ layout: "rail", width: 64, per: {} });
    expect(readTopicSettings().layout).toBe("rail");
  });

  it("sets the default to Tabs and drops the current contact's own choice", () => {
    save({ layout: "column", width: 300, per: { "trunk:oak": "side", "trunk:juniper": "rail" } });
    const events = vi.fn();
    window.addEventListener("branch:topic-layout-changed", events);
    setR1TopicLayout("tabs", "trunk:oak");
    expect(events).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(TOPIC_LAYOUT_KEY)!)).toEqual({ layout: "tabs", width: 0, per: { "trunk:juniper": "rail" } });
    expect(r1TopicLayoutFor("trunk:oak")).toBe("tabs");
    window.removeEventListener("branch:topic-layout-changed", events);
  });
  it("#1049: sets one contact's own layout from its View menu, keeping the default", () => {
    setR1TopicLayout("free");
    setR1ContactTopicLayout("trunk:oak", "tabs");
    expect(r1TopicLayoutFor("trunk:oak")).toBe("tabs");
    expect(r1TopicLayoutFor("trunk:juniper")).toBe("free");
    expect(r1DefaultTopicLayout()).toBe("free");
  });
});
