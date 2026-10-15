import { describe, expect, it } from "vitest";
import { CHAT_APP_ROWS } from "../chatapps";
import { R1_PAGES } from "./pages/plugged";
import { ROWS, type Row } from "./rows";
import { mergeRows } from "./slots";

const row = (id: string, page: Row["page"] = "chatapps"): Row => ({ id, page, card: "Commands", level: 0, control: "toggle", source: { kind: "coming", need: "x", reason: "x" } });

describe("mergeRows", () => {
  it("adds a page's rows after the table, by stable id and in order", () => {
    const merged = mergeRows([row("general.a", "general")], { chatapps: { rows: [row("chatapps.b"), row("chatapps.c")] } });
    expect(merged.map((r) => r.id)).toEqual(["general.a", "chatapps.b", "chatapps.c"]);
  });

  it("fails on an id used twice: between the table and a page, inside a page, or inside the table", () => {
    expect(() => mergeRows([row("chatapps.b")], { chatapps: { rows: [row("chatapps.b")] } })).toThrow('Settings row id "chatapps.b" is used twice (the row table and page "chatapps")');
    expect(() => mergeRows([], { chatapps: { rows: [row("chatapps.b"), row("chatapps.b")] } })).toThrow(/used twice/);
    expect(() => mergeRows([row("general.a", "general"), row("general.a", "general")])).toThrow(/used twice/);
  });

  it("fails when a page adds a row that belongs to another page", () => {
    expect(() => mergeRows([], { chatapps: { rows: [row("general.x", "general")] } })).toThrow('Settings row "general.x" is on page "general" but page "chatapps" adds it.');
  });

  it("draws a page's own control only for a row of that page", () => {
    const control = () => null;
    expect(() => mergeRows([row("general.a", "general")], { general: { controls: { "general.a": control } } })).not.toThrow();
    expect(() => mergeRows([row("general.a", "general")], { general: { controls: { "general.zz": control } } })).toThrow('Page "general" draws a control for row "general.zz", which is not a row of that page.');
    expect(() => mergeRows([row("general.a", "general")], { appearance: { controls: { "general.a": control } } })).toThrow(/not a row of that page/);
    // Every control the shipped pages draw is for one of their own rows.
    expect(() => mergeRows(ROWS, R1_PAGES)).not.toThrow();
    expect(Object.keys(R1_PAGES.appearance?.controls ?? {}).length).toBeGreaterThan(0);
  });

  it("keeps the shipped table unique: every R1 row and every Chat apps row, merged once", () => {
    const merged = mergeRows(ROWS, R1_PAGES);
    expect(new Set(merged.map((r) => r.id)).size).toBe(merged.length);
    expect(merged.filter((r) => r.page === "chatapps").map((r) => r.id)).toEqual(CHAT_APP_ROWS.map((r) => r.id));
    expect(R1_PAGES.chatapps?.component).toBeTypeOf("function");
  });
});
