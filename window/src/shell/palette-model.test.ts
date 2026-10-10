import { describe, expect, it } from "vitest";
import { filterPalette, moveSelection, type PaletteRow } from "./palette-model";

const r = (group: string, label: string, hint = ""): PaletteRow => ({ id: `${group}:${label}`, group, label, hint, run: () => undefined });

describe("palette model", () => {
  it("filters on label or hint and keeps the group order", () => {
    const rows = [r("Settings", "Models", "Settings"), r("Actions", "New conversation", "Ctrl N"), r("Places", "Inbox", "Place")];
    expect(filterPalette(rows, "").map((x) => x.group)).toEqual(["Actions", "Places", "Settings"]);
    expect(filterPalette(rows, "place").map((x) => x.label)).toEqual(["Inbox"]);
    expect(filterPalette(rows, "MODEL").map((x) => x.label)).toEqual(["Models"]);
  });
  it("finds a row by its keywords, and ranks an exact title first", () => {
    const rows = [
      { ...r("Settings", "Grafts", "Settings"), keywords: "skills agents capabilities" },
      r("Places", "Skills", "Place"),
      r("Actions", "Install update", "Update"),
    ];
    expect(filterPalette(rows, "skills").map((x) => x.label)).toEqual(["Skills", "Grafts"]);
    expect(filterPalette(rows, "capabilities").map((x) => x.label)).toEqual(["Grafts"]);
    expect(filterPalette(rows, "install").map((x) => x.label)).toEqual(["Install update"]);
  });
  it("never moves past the ends", () => {
    expect(moveSelection(0, -1, 3)).toBe(0);
    expect(moveSelection(2, 1, 3)).toBe(2);
    expect(moveSelection(1, 1, 3)).toBe(2);
    expect(moveSelection(0, 1, 0)).toBe(0);
  });
});
