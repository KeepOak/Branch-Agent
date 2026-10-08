import { describe, expect, it } from "vitest";
import { dropZoneAt, reorderedPins, type DropZone } from "./sidebar-drag";

describe("sidebar drag zones", () => {
  it("returns no zone for an empty set and the only zone at any position", () => {
    expect(dropZoneAt(50, 100, 80, [])).toBeNull();
    expect(dropZoneAt(-100, 100, 80, ["onto"])).toBe("onto");
    expect(dropZoneAt(500, 100, 80, ["onto"])).toBe("onto");
  });

  it("splits two zones at the midpoint and clamps outside positions", () => {
    const zones: readonly DropZone[] = ["after", "before"];
    expect(dropZoneAt(99, 100, 80, zones)).toBe("after");
    expect(dropZoneAt(139.99, 100, 80, zones)).toBe("after");
    expect(dropZoneAt(140, 100, 80, zones)).toBe("before");
    expect(dropZoneAt(181, 100, 80, zones)).toBe("before");
  });

  it("reserves the middle half for onto in three-zone targets", () => {
    const zones: readonly DropZone[] = ["before", "onto", "after"];
    expect(dropZoneAt(119.99, 100, 80, zones)).toBe("before");
    expect(dropZoneAt(120, 100, 80, zones)).toBe("onto");
    expect(dropZoneAt(160, 100, 80, zones)).toBe("onto");
    expect(dropZoneAt(160.01, 100, 80, zones)).toBe("after");
    expect(dropZoneAt(180, 100, 80, zones)).toBe("after");
  });

  it("uses a minimum projected length of one pixel", () => {
    expect(dropZoneAt(100, 100, 0, ["before", "after"])).toBe("before");
    expect(dropZoneAt(101, 100, 0, ["before", "after"])).toBe("after");
  });
});

describe("sidebar pin reorder", () => {
  const order = ["oak", "elm", "ash", "pine"];

  it("moves a later pin before its target and an earlier pin after its target", () => {
    expect(reorderedPins(order, "pine", "elm", "before")).toEqual(["oak", "pine", "elm", "ash"]);
    expect(reorderedPins(order, "oak", "ash", "after")).toEqual(["elm", "ash", "oak", "pine"]);
    expect(order).toEqual(["oak", "elm", "ash", "pine"]);
  });

  it("keeps order for self, onto, or missing pins and returns a fresh array", () => {
    for (const [source, target, zone] of [
      ["elm", "elm", "before"],
      ["elm", "ash", "onto"],
      ["missing", "elm", "before"],
      ["elm", "missing", "after"],
    ] as const) {
      const result = reorderedPins(order, source, target, zone);
      expect(result).toEqual(order);
      expect(result).not.toBe(order);
    }
  });
});
