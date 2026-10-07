import { describe, expect, it } from "vitest";
import { pixelCells, PIXEL_POSES, PIXEL_REACTIONS, PIXEL_REST } from "./pet-pixel";

describe("preview pixel pose maps", () => {
  it("keeps all three resting drawings and never creates coloured cells outside their palettes", () => {
    for (const [kind, pet] of Object.entries(PIXEL_POSES)) {
      expect(pixelCells(`px-${kind}`, PIXEL_REST).length).toBeGreaterThan(0);
      for (const frames of Object.values(PIXEL_REACTIONS)) for (const frame of frames) {
        expect(pixelCells(`px-${kind}`, frame).every(cell => Object.values(pet.col).includes(cell.colour))).toBe(true);
      }
    }
  });
  it("closes the owl eyes on pat and changes only the feet on a notice step", () => {
    const rest = pixelCells("px-owl", PIXEL_REST);
    const shut = pixelCells("px-owl", { ...PIXEL_REST, shut:true });
    expect(shut.filter(cell => cell.colour === "#1B1A18")).toHaveLength(0);
    expect(shut).toHaveLength(rest.length);
    const perk = pixelCells("px-owl", { ...PIXEL_REST, pose:"perk" });
    const step = pixelCells("px-owl", { ...PIXEL_REST, pose:"perk", step:true });
    const changed = step.filter((cell,index) => cell.y !== perk[index].y);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every(cell => cell.y === 15)).toBe(true);
  });
  it("ends every reaction at rest without lift or a foot step", () => {
    for (const frames of Object.values(PIXEL_REACTIONS)) {
      expect(frames.at(-1)).toMatchObject({ pose:"rest", lift:0 });
    }
    expect(pixelCells("unrecognised", PIXEL_REST)).toEqual([]);
  });
});
