import { describe, expect, it } from "vitest";
import { chipWords, helperMark, needsYou } from "./Helpers";

describe("helpers chip and marks (§4.2.2, §4.4.10)", () => {
  it("words the chip", () => {
    expect(chipWords(1, 0, false)).toEqual({ lead: "1 helper", tail: null });
    expect(chipWords(3, 1, false)).toEqual({ lead: "3 helpers", tail: "1 needs you" });
    expect(chipWords(3, 2, false)).toEqual({ lead: "3 helpers", tail: "2 need you" });
    expect(chipWords(2, 0, true)).toEqual({ lead: "2 helpers", tail: "done" });
  });

  it("agrees the verb with the count in the helpers tree", () => {
    expect([needsYou(1), needsYou(2), needsYou(5)]).toEqual(["1 needs you", "2 need you", "5 need you"]);
  });

  it("marks each helper from its engine status", () => {
    const h = { key: "k", name: "n", parent: "p" };
    expect(helperMark({ ...h, status: "running" }, false)).toBe("working");
    expect(helperMark({ ...h, status: "running", updatedAt: Date.now() - 11 * 60_000 }, false)).toBe("stalled");
    expect(helperMark({ ...h, status: "running" }, true)).toBe("waiting");
    expect(helperMark({ ...h, status: "done" }, false)).toBe("done");
    expect(helperMark({ ...h, status: "killed" }, false)).toBe("stopped");
  });
});
