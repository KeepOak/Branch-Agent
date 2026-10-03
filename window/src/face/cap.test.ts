import { describe, expect, it } from "vitest";
import { FaceCap, PRIORITY } from "./cap";

describe("FaceCap (DESIGN-SPEC §6.7)", () => {
  it("lets at most 12 pebbles and 6 videos play", () => {
    const cap = new FaceCap();
    for (let i = 0; i < 12; i += 1) expect(cap.request(i, "pebble", PRIORITY.row, () => undefined)).toBe(true);
    expect(cap.request(99, "pebble", PRIORITY.row, () => undefined)).toBe(false);
    for (let i = 100; i < 106; i += 1) expect(cap.request(i, "video", PRIORITY.row, () => undefined)).toBe(true);
    expect(cap.request(200, "video", PRIORITY.row, () => undefined)).toBe(false);
    expect(cap.playing("pebble")).toBe(12);
  });

  it("sends the weakest face back to its still for the open conversation's Trunk", () => {
    const cap = new FaceCap({ pebble: 2, video: 6 });
    const revoked: number[] = [];
    cap.request(1, "pebble", PRIORITY.row, () => revoked.push(1));
    cap.request(2, "pebble", PRIORITY.active, () => revoked.push(2));
    expect(cap.request(3, "pebble", PRIORITY.open, () => revoked.push(3))).toBe(true);
    expect(revoked).toEqual([1]);
    cap.release(3);
    expect(cap.request(4, "pebble", PRIORITY.row, () => undefined)).toBe(true);
  });
});
