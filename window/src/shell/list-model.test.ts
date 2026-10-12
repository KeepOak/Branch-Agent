import { describe, expect, it } from "vitest";
import type { Conversation } from "../connect/conversations";
import { buildSections, DEFAULT_PREFS, emptyLineFor, filterRows, filterSummary, filtersDiffer, homeRow, roomUsed, rowTime } from "./list-model";

const base: Conversation = {
  key: "k",
  title: "",
  isMain: false,
  pinned: false,
  archived: false,
  unread: false,
  snoozedUntil: null,
  createdAt: 0,
  updatedAt: 0,
  preview: "",
  working: false,
  kind: "direct",
  system: false,
  automation: false,
  totalTokens: 0,
  contextTokens: 0,
  agentId: "dev",
};
const row = (patch: Partial<Conversation>): Conversation => ({ ...base, ...patch });
const NOW = 1_000_000;

describe("filterRows", () => {
  const rows = [
    row({ key: "main", isMain: true }),
    row({ key: "a" }),
    row({ key: "arch", archived: true }),
    row({ key: "snz", snoozedUntil: NOW + 10 }),
    row({ key: "woke", snoozedUntil: NOW - 10 }),
    row({ key: "sys", system: true }),
    row({ key: "cron", automation: true }),
    row({ key: "other", agentId: "x" }),
  ];
  const keys = (p = DEFAULT_PREFS, open: string | null = null) => filterRows(rows, p, NOW, open).map((r) => r.key);

  it("Active hides archived, snoozed, system and automation rows and never lists the main conversation", () => {
    expect(keys()).toEqual(["a", "woke", "other"]);
  });
  it("keeps the open conversation even when archived", () => {
    expect(keys(DEFAULT_PREFS, "arch")).toContain("arch");
  });
  it("Snoozed, Archived and All", () => {
    expect(keys({ ...DEFAULT_PREFS, status: "snoozed" })).toEqual(["snz"]);
    expect(keys({ ...DEFAULT_PREFS, status: "archived" })).toEqual(["arch"]);
    expect(keys({ ...DEFAULT_PREFS, status: "all" })).toEqual(["a", "arch", "snz", "woke", "other"]);
  });
  it("the switches and the Trunk filter", () => {
    expect(keys({ ...DEFAULT_PREFS, showSystem: true, showAutomation: true })).toEqual(["a", "woke", "sys", "cron", "other"]);
    expect(keys({ ...DEFAULT_PREFS, trunk: "x" })).toEqual(["other"]);
  });
});

describe("buildSections", () => {
  const rows = [row({ key: "old", createdAt: 1, updatedAt: 9 }), row({ key: "new", createdAt: 5, updatedAt: 6 }), row({ key: "pin", pinned: true, createdAt: 2 })];
  it("Pinned then Recent, newest created first", () => {
    const s = buildSections(rows, DEFAULT_PREFS, NOW, null);
    expect(s.map((x) => [x.id, x.rows.map((r) => r.key)])).toEqual([
      ["pinned", ["pin"]],
      ["recent", ["new", "old"]],
    ]);
  });
  it("sorts by latest activity and groups as one flat list", () => {
    const s = buildSections(rows, { ...DEFAULT_PREFS, sortBy: "activity", groupBy: "none" }, NOW, null);
    expect(s).toHaveLength(1);
    expect(s[0].label).toBeNull();
    expect(s[0].rows.map((r) => r.key)).toEqual(["old", "new", "pin"]);
  });
  it("groups by Trunk", () => {
    const s = buildSections([row({ key: "a", agentId: "dev" }), row({ key: "b", agentId: "x" })], { ...DEFAULT_PREFS, groupBy: "trunk" }, NOW, null);
    expect(s.map((x) => x.id)).toEqual(["trunk:dev", "trunk:x"]);
  });
  it("hides Pinned when nothing is pinned", () => {
    expect(buildSections([row({ key: "a" })], DEFAULT_PREFS, NOW, null).map((x) => x.id)).toEqual(["recent"]);
  });
});

describe("homeRow", () => {
  it("uses the engine row when it exists, named after the Trunk", () => {
    const h = homeRow([row({ key: "agent:dev:main", title: "x", unread: true })], "agent:dev:main", "Sapling");
    expect(h).toMatchObject({ key: "agent:dev:main", title: "Sapling", isMain: true, unread: true });
  });
  it("is made from the main key before the conversation exists", () => {
    expect(homeRow([], "agent:dev:main", "Sapling")).toMatchObject({ key: "agent:dev:main", title: "Sapling", isMain: true });
    expect(homeRow([], null, "Sapling")).toBeNull();
  });
});

describe("words and readouts", () => {
  it("filter summary and the dot", () => {
    expect(filterSummary({ ...DEFAULT_PREFS, status: "snoozed", trunk: "dev" }, () => "Sapling")).toBe("Snoozed · Only Sapling");
    expect(filtersDiffer(DEFAULT_PREFS)).toBe(false);
    expect(filtersDiffer({ ...DEFAULT_PREFS, sortBy: "activity" })).toBe(false);
    expect(filtersDiffer({ ...DEFAULT_PREFS, status: "all" })).toBe(true);
  });
  it("empty lines", () => {
    expect(emptyLineFor({ ...DEFAULT_PREFS, status: "snoozed" }, 0)).toBe("No snoozed conversations.");
    expect(emptyLineFor({ ...DEFAULT_PREFS, status: "archived" }, 0)).toBe("No archived conversations.");
    expect(emptyLineFor({ ...DEFAULT_PREFS, trunk: "x" }, 0)).toBe("Nothing matches these filters.");
    expect(emptyLineFor(DEFAULT_PREFS, 0)).toBeNull();
    expect(emptyLineFor({ ...DEFAULT_PREFS, trunk: "x" }, 2)).toBeNull();
  });
  it("room used", () => {
    expect(roomUsed(row({ totalTokens: 100, contextTokens: 400 }))).toBe(0.25);
    expect(roomUsed(row({}))).toBeNull();
    expect(roomUsed(null)).toBeNull();
  });
  it("row times", () => {
    const now = new Date(2026, 9, 2, 15, 0).getTime();
    expect(rowTime(now - 10_000, now)).toBe("now");
    expect(rowTime(new Date(2026, 9, 1, 9, 0).getTime(), now)).toBe("Yesterday");
    expect(rowTime(0, now)).toBe("");
  });
});
