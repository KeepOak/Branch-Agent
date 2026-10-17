import { describe, expect, it, vi } from "vitest";
import { paletteRows } from "./palette-rows";

const noop = () => undefined;
function rows(toggleLockdown?: () => void, lockdownOn = false, canDo?: () => void, tryExamples?: () => void) {
  return paletteRows({
    conversations: [], trunks: [], trunkName: () => "Sapling", newConversation: noop, toggleTheme: noop, focusMode: noop,
    shortcuts: noop, setup: noop, tour: noop, quickAsk: noop, openConversation: noop, openPlace: noop, openSettings: noop,
    newTrunk: noop, toggleLockdown, lockdownOn, canDo, tryExamples,
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

it("offers Try it with examples after onboarding, the same action the Trunks page runs", () => {
  const tryExamples = vi.fn();
  const row = rows(undefined, false, undefined, tryExamples).find((item) => item.label === "Try it with examples");
  expect(row).toBeDefined();
  expect(row?.keywords).toMatch(/practice|sample/);
  row?.run();
  expect(tryExamples).toHaveBeenCalledOnce();
});

it("keeps What Branch can do discoverable in Find anything after removing it from Guide", () => {
  const canDo = vi.fn();
  const row = rows(undefined, false, canDo).find(row => row.label === "What Branch can do");
  expect(row).toBeDefined();
  row?.run();
  expect(canDo).toHaveBeenCalledOnce();
});
