import { expect, it } from "vitest";
import type { Draft } from "./api";
import { COLOURS, EYES, SHAPES } from "./LookTab";
import { readMay } from "./may";
import { EMOJI, LOOKS } from "./model";
import { shuffleLook, visibleFace } from "./shuffle";

const pebble: Draft = { name: "Demo", theme: "", look: "classic", emoji: "", colour: COLOURS[0], shape: SHAPES[0], eyes: EYES[0], model: "", may: readMay({ hash: "demo", valid: true, config: {} }, "demo") };
const mascots = LOOKS.filter((look) => look.id !== "classic" && look.id !== "branch").map((look) => look.id);
function seeded(seed: number) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

it.each([
  ["mascot", { ...pebble, look: mascots[0] }],
  ["emoji", { ...pebble, emoji: EMOJI[0] }],
  ["pebble", pebble],
] as const)("always changes the visible %s across 200 seeded sequences", (_kind, initial) => {
  for (let seed = 0; seed < 200; seed++) {
    const random = seeded(seed);
    let draft = initial;
    for (let step = 0; step < 20; step++) {
      const next = { ...draft, ...shuffleLook(draft, new Set(), random) };
      expect(visibleFace(next)).not.toBe(visibleFace(draft));
      draft = next;
    }
  }
});

it("keeps emoji faces classic and chooses another emoji from the picker", () => {
  for (const emoji of EMOJI) {
    const next = shuffleLook({ ...pebble, emoji }, new Set(), seeded(1));
    expect(next.look).toBe("classic");
    expect(next.emoji).not.toBe(emoji);
    expect(EMOJI).toContain(next.emoji);
  }
});

it("prefers an unworn mascot and excludes Classic, Branch and the current mascot", () => {
  const draft = { ...pebble, look: mascots[0] };
  const free = mascots[1];
  for (let seed = 0; seed < 200; seed++) {
    expect(shuffleLook(draft, new Set(mascots.filter((id) => id !== free)), seeded(seed))).toEqual({ look: free, emoji: "" });
  }
});

it("still chooses another mascot when every mascot is worn", () => {
  for (const look of mascots) {
    const next = shuffleLook({ ...pebble, look }, new Set(mascots), seeded(1));
    expect(mascots).toContain(next.look);
    expect(next.look).not.toBe(look);
  }
});
