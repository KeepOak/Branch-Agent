// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { r1DefaultTopicLayout, r1LayoutOf, r1TopicLayoutFor, r1TopicLayoutNames, readTopicSettings, setR1TopicLayout, TOPIC_LAYOUT_KEY } from "./topic-layout";

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

const save = (value: unknown) => localStorage.setItem(TOPIC_LAYOUT_KEY, JSON.stringify(value));

describe("R1 thread layouts (owner item 47)", () => {
  it("offers only Tabs above the chat", () => {
    expect(Object.keys(r1TopicLayoutNames)).toEqual(["tabs"]);
    expect(r1TopicLayoutNames.tabs).toBe("Tabs above the chat");
  });

  it("defaults to Tabs above the chat when nothing is saved", () => {
    expect(r1DefaultTopicLayout()).toBe("tabs");
    expect(r1TopicLayoutFor("trunk:oak")).toBe("tabs");
  });

  it("maps every removed or damaged saved layout to Tabs, for the default and for a contact", () => {
    for (const layout of ["column", "rail", "side", "unknown", null, 7]) {
      save({ layout, width: 300, per: { "trunk:oak": layout } });
      expect(r1DefaultTopicLayout()).toBe("tabs");
      expect(r1TopicLayoutFor("trunk:oak")).toBe("tabs");
    }
    expect(r1LayoutOf("column")).toBe("tabs");
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
});
