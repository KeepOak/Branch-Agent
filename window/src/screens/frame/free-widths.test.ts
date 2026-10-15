// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collapseBoth, commitSide, commitTopics, FREE_DEFAULT, forgetFreeForTests, getFree, maxSide, maxTopics, parseFree, proportional, RAIL_W, resetFree,
  setFree, sideNow, sideTier, step, toggleRail, topicsTier, TOPICS_MIN,
} from "./free-widths";

const APP = 1440;
beforeEach(() => { localStorage.clear(); forgetFreeForTests(); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); forgetFreeForTests(); });

describe("Freedom Mode limits (preview 44137-44300)", () => {
  it("caps each side at 45% of the window and keeps the chat at 420 px", () => {
    expect(maxSide(APP, 300)).toBeCloseTo(648, 5);
    expect(maxTopics(APP, 292)).toBeCloseTo(648, 5);
    expect(maxSide(900, 300)).toBe(180);
    expect(maxTopics(500, 292)).toBe(64);
  });

  it("classes the widths into four content tiers", () => {
    expect([100, 200, 300, 400].map(sideTier)).toEqual([1, 2, 3, 4]);
    expect([100, 150, 250, 350].map(topicsTier)).toEqual([1, 2, 3, 4]);
  });
});

describe("drag commits", () => {
  it("closes a sidebar below 40 px, makes it a rail below 180 px, and keeps a wide one within its maximum", () => {
    expect(commitSide(FREE_DEFAULT, 30, APP)).toMatchObject({ sideHidden: true });
    expect(commitSide(FREE_DEFAULT, 120, APP)).toMatchObject({ sideRail: true, sideHidden: false });
    expect(commitSide(FREE_DEFAULT, 350.4, APP)).toMatchObject({ side: 350, sideRail: false });
    expect(commitSide(FREE_DEFAULT, 2000, APP).side).toBe(maxSide(APP, FREE_DEFAULT.topics));
  });

  it("closes the threads column below 40 px and keeps it between 64 px and its maximum", () => {
    expect(commitTopics(FREE_DEFAULT, 20, APP).topics).toBe(0);
    expect(commitTopics(FREE_DEFAULT, 10, APP).topics).toBe(0);
    expect(commitTopics(FREE_DEFAULT, 50, APP).topics).toBe(64);
    expect(commitTopics(FREE_DEFAULT, 5000, APP).topics).toBe(maxTopics(APP, 292));
  });

  it("alt-drag moves the other edge in proportion, inside its own limits", () => {
    expect(proportional(400, 300, 200, 900)).toBeCloseTo(266.67, 1);
    expect(proportional(10, 300, 200, 900)).toBe(64);
    expect(proportional(400, 0, 200, 900)).toBe(200);
  });
});

describe("keyboard steps, double-click and ⌘\\", () => {
  it("steps the topics width by 80 px, and closes it when it goes back past the rail", () => {
    expect(step(FREE_DEFAULT, "topics", 1, APP).topics).toBe(380);
    expect(step(FREE_DEFAULT, "topics", -1, APP).topics).toBe(220);
    const narrow = { ...FREE_DEFAULT, topics: 64 };
    expect(step(narrow, "topics", -1, APP).topics).toBe(0);
    expect(step({ ...FREE_DEFAULT, topics: 0 }, "topics", 1, APP).topics).toBe(64);
  });

  it("steps the sidebar: shrinks to the rail, then closes; grows back from closed", () => {
    expect(step(FREE_DEFAULT, "side", -1, APP)).toMatchObject({ side: 212 });
    const rail = { ...FREE_DEFAULT, sideRail: true };
    expect(step(rail, "side", -1, APP)).toMatchObject({ sideHidden: true });
    expect(step({ ...FREE_DEFAULT, sideHidden: true }, "side", 1, APP)).toMatchObject({ sideHidden: false, sideRail: true });
    expect(step({ ...FREE_DEFAULT, sideRail: true }, "side", 1, APP)).toMatchObject({ sideRail: false, side: 292 });
  });

  it("double-click toggles each edge between its rail and its last width", () => {
    const railed = toggleRail(FREE_DEFAULT, "side");
    expect(railed).toMatchObject({ sideRail: true, lastSide: 292 });
    expect(toggleRail(railed, "side")).toMatchObject({ sideRail: false, side: 292 });
    const closed = toggleRail(FREE_DEFAULT, "topics");
    expect(closed.topics).toBe(TOPICS_MIN);
    expect(toggleRail(closed, "topics").topics).toBe(300);
  });

  it("⌘\\ collapses both to rails, and a second press brings them back", () => {
    const both = collapseBoth(FREE_DEFAULT, true);
    expect(both).toMatchObject({ sideRail: true, topics: TOPICS_MIN, lastSide: 292, lastTopics: 300 });
    const back = collapseBoth(both, true);
    expect(back).toMatchObject({ sideRail: false, sideHidden: false, side: 292, topics: 300 });
  });
});

describe("saved widths", () => {
  it("falls back to the usual sizes for nothing, damaged JSON, or wrong types", () => {
    expect(parseFree(null)).toEqual(FREE_DEFAULT);
    expect(parseFree("{not json")).toEqual(FREE_DEFAULT);
    expect(parseFree(JSON.stringify({ side: "wide", topics: -4 }))).toEqual({ ...FREE_DEFAULT, last: "topics" });
  });

  it("writes the widths to storage and reads them back; reset puts the usual sizes back", () => {
    setFree({ ...FREE_DEFAULT, side: 340, topics: 220, last: "side" });
    expect(JSON.parse(localStorage.getItem("branch.r1.free")!)).toMatchObject({ side: 340, topics: 220, last: "side" });
    forgetFreeForTests();
    expect(getFree()).toMatchObject({ side: 340, topics: 220, last: "side" });
    resetFree();
    expect(getFree()).toEqual(FREE_DEFAULT);
  });

  it("keeps the widths for this window when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => setFree({ ...FREE_DEFAULT, side: 300 })).not.toThrow();
    expect(getFree().side).toBe(300);
  });

  it("gives the sidebar's width on screen", () => {
    expect(sideNow(FREE_DEFAULT)).toBe(292);
    expect(sideNow({ ...FREE_DEFAULT, sideRail: true })).toBe(RAIL_W);
    expect(sideNow({ ...FREE_DEFAULT, sideHidden: true })).toBe(0);
  });
});
