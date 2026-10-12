import { describe, expect, it } from "vitest";
import { shows } from "./level";

describe("shows", () => {
  it("shows Regular rows at every level", () => {
    expect(shows("regular", "regular")).toBe(true);
    expect(shows("technical", "regular")).toBe(true);
  });
  it("shows [A] rows from Advanced up", () => {
    expect(shows("regular", "advanced")).toBe(false);
    expect(shows("advanced", "advanced")).toBe(true);
    expect(shows("technical", "advanced")).toBe(true);
  });
  it("shows [T] rows only at Technical", () => {
    expect(shows("advanced", "technical")).toBe(false);
    expect(shows("technical", "technical")).toBe(true);
  });
});
