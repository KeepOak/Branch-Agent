import { describe, expect, it, vi } from "vitest";
import { paletteRows } from "./palette-rows";

const noop = () => undefined;
function rows(toggleLockdown?: () => void, lockdownOn = false) {
  return paletteRows({
    conversations: [], trunks: [], trunkName: () => "Sapling", newConversation: noop, toggleTheme: noop, focusMode: noop,
    shortcuts: noop, setup: noop, tour: noop, quickAsk: noop, openConversation: noop, openPlace: noop, openSettings: noop,
    newTrunk: noop, toggleLockdown, lockdownOn,
  });
}
const actions = (list: ReturnType<typeof rows>) => list.filter((row) => row.group === "Actions").map((row) => row.label);

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
