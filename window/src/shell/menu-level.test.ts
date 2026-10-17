import { describe, expect, it } from "vitest";
import type { MenuItem } from "./Menu";
import { menuAtLevel } from "./menu-level";
import { isComingWhy } from "./shown-why";
import { SETTINGS_MENU_COMING, TRUNK_MENU_COMING } from "../places/customize/trunks";

const run = () => undefined;
const ITEMS: MenuItem[] = [
  { label: "Change picture…", run },
  { label: "Pause", run, disabled: SETTINGS_MENU_COMING.pause },
  { label: "Make default", run, disabled: "Oak is your default Trunk." },
  { label: "Package…", run, disabled: TRUNK_MENU_COMING.packages },
  { kind: "sep" },
  { label: "Copy seed", run, disabled: SETTINGS_MENU_COMING.seed },
  { kind: "sep" },
  { label: "Remove Trunk…", run, danger: true },
];
const labels = (items: MenuItem[]) => items.map((it) => ("label" in it ? it.label : it.kind));

describe("Coming menu items wait for Technical (Private #1093)", () => {
  it("tells a Coming reason from a real condition", () => {
    for (const why of Object.values(SETTINGS_MENU_COMING)) expect(isComingWhy(why)).toBe(true);
    for (const why of ["Oak is your default Trunk.", "Turn on “Compress older transcripts” first.", "Needs a newer Branch app on this computer.", "Its plugin isn’t installed in this engine.", "", undefined]) expect(isComingWhy(why)).toBe(false);
  });

  it("drops Coming items below Technical, keeps items greyed for a real condition, and closes up the separators", () => {
    expect(labels(menuAtLevel(ITEMS, false, Object.values(TRUNK_MENU_COMING)))).toEqual(["Change picture…", "Make default", "sep", "Remove Trunk…"]);
    expect(labels(menuAtLevel(ITEMS, true, Object.values(TRUNK_MENU_COMING)))).toEqual(labels(ITEMS));
  });
});
