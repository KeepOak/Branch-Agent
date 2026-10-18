import { describe, expect, it } from "vitest";
import { firstHit, searchSettings } from "./search";
import type { Row } from "./rows";

const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({ id: `general.writing.r${i}`, page: "general", card: "Writing", label: `Spell check ${i}`, level: 0, control: "toggle", source: { kind: "pref", key: `k${i}` } }));

describe("settings search", () => {
  it("is empty for a blank query", () => {
    const g = searchSettings("  ", { level: 0, hints: {} });
    expect([...g.settings, ...g.goto, ...g.trunks, ...g.features]).toEqual([]);
    expect(firstHit(g)).toBeNull();
  });

  it("finds pages by title and rows by label, with at most 14 rows", () => {
    const g = searchSettings("spell", { level: 0, hints: {}, rows });
    expect(g.settings.filter((h) => h.kind === "row").length).toBe(14);
    const pages = searchSettings("appear", { level: 0, hints: {}, rows: [] }).settings;
    expect(pages[0]).toMatchObject({ kind: "page", id: "appearance", label: "Appearance" });
  });

  it("finds a row by its help and card, and says where it lives", () => {
    const g = searchSettings("summarising gist", { level: 2, hints: {} });
    expect(g.settings[0]).toMatchObject({ kind: "row", id: "general.line.drop", sub: "General › Waiting line", level: 2 });
  });

  it("keeps Developer out below Technical", () => {
    expect(searchSettings("developer", { level: 1, hints: {}, rows: [] }).settings).toEqual([]);
    expect(searchSettings("developer", { level: 2, hints: {}, rows: [] }).settings[0]).toMatchObject({ id: "developer" });
  });

  it("groups Trunks with Make default and New Trunk, and features up to 6 at Technical only", () => {
    const trunks = [{ id: "a", name: "Writer", isDefault: true }, { id: "b", name: "Write checker" }];
    const features = Array.from({ length: 9 }, (_, i) => ({ id: `f${i}`, name: `Write feature ${i}` }));
    const g = searchSettings("writ", { level: 0, hints: {}, rows: [], trunks, features });
    expect(g.trunks).toEqual([{ kind: "trunk", id: "a", label: "Writer", actions: ["open"] }, { kind: "trunk", id: "b", label: "Write checker", actions: ["open", "makeDefault"] }]);
    // The feature atlas is mostly what Branch plans: Regular and Advanced search never list it (Private #1093 item 4).
    expect(g.features).toEqual([]);
    expect(searchSettings("writ", { level: 1, hints: {}, rows: [], trunks, features }).features).toEqual([]);
    expect(searchSettings("writ", { level: 2, hints: {}, rows: [], trunks, features }).features.length).toBe(6);
    expect(searchSettings("new", { level: 0, hints: {}, rows: [], trunks }).trunks).toEqual([{ kind: "newTrunk", id: "new-trunk", label: "New Trunk" }]);
  });

  it("finds a row that waits for a later update only at Technical, so Regular and Advanced search never switch the level for it", () => {
    const later: Row[] = [{ id: "general.writing.later", page: "general", card: "Writing", label: "Spell later", level: 0, control: "toggle", source: { kind: "coming", need: "x.y", reason: "Spell later comes in a later update." } }];
    expect(searchSettings("spell later", { level: 0, hints: {}, rows: later }).settings).toEqual([]);
    expect(searchSettings("spell later", { level: 1, hints: {}, rows: later }).settings).toEqual([]);
    expect(searchSettings("spell later", { level: 2, hints: {}, rows: later }).settings[0]).toMatchObject({ kind: "row", id: "general.writing.later", level: 2 });
  });

  it("ranks a label that starts with the query first", () => {
    const g = searchSettings("send", { level: 1, hints: {} });
    expect(firstHit(g)).toMatchObject({ kind: "row", id: "general.conversation.send" });
  });
});
