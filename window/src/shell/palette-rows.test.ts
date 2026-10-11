import { describe, expect, it, vi } from "vitest";
import { PLACES, type PlaceId } from "../places-nav/routes";
import { filterPalette } from "./palette-model";
import { paletteRows } from "./palette-rows";

const noop = () => undefined;
function rows(toggleLockdown?: () => void, lockdownOn = false, openPlace: (p: PlaceId) => void = noop) {
  return paletteRows({
    conversations: [], trunks: [], trunkName: () => "Sapling", newConversation: noop, toggleTheme: noop, focusMode: noop,
    shortcuts: noop, setup: noop, tour: noop, quickAsk: noop, openConversation: noop, openPlace, openSettings: noop,
    newTrunk: noop, toggleLockdown, lockdownOn,
  });
}
const actions = (list: ReturnType<typeof rows>) => list.filter((row) => row.group === "Actions").map((row) => row.label);
const places = (list: ReturnType<typeof rows>) => list.filter((row) => row.group === "Places");

describe("palette Lockdown action (preview index.html:8674)", () => {
  it("offers Turn Lockdown on, after New Trunk, and runs the toggle", () => {
    const toggle = vi.fn();
    const list = rows(toggle, false);
    expect(actions(list).slice(0, 3)).toEqual(["New conversation", "New Trunk", "Turn Lockdown on"]);
    list.find((row) => row.label === "Turn Lockdown on")?.run();
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("reads Turn Lockdown off while locked", () => {
    expect(actions(rows(vi.fn(), true))).toContain("Turn Lockdown off");
  });

  it("is absent when the engine has no Lockdown switch", () => {
    expect(actions(rows(undefined)).some((label) => label.includes("Lockdown"))).toBe(false);
  });
});

describe("palette Grove place", () => {
  it("lists Grove in Places after the sidebar places, without adding office to the sidebar list", () => {
    const labels = places(rows()).map((row) => row.label);
    expect(PLACES.map((p) => p.id)).not.toContain("office");
    expect(labels).toEqual([...PLACES.map((p) => p.name), "Grove"]);
  });

  it("shows Grove when typing grove and opens the office when run", () => {
    const openPlace = vi.fn();
    const grove = filterPalette(rows(undefined, false, openPlace), "grove").find((row) => row.label === "Grove");
    expect(grove?.group).toBe("Places");
    expect(grove?.hint).toBe("Place");
    grove?.run();
    expect(openPlace).toHaveBeenCalledWith("office");
  });
});
