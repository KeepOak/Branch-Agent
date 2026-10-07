import { describe, expect, it } from "vitest";
import { CARE, FIRST_JOB, nextTrunkName } from "./NewTrunkFlow";

describe("New Trunk", () => {
  it("asks the artifact's questions", () => {
    expect(FIRST_JOB.map((o) => o.label)).toEqual(["Inbox & calendar", "Money & receipts", "Research", "Files on this computer", "Something else"]);
    expect(CARE.map((o) => o.mode)).toEqual(["guarded", "workspace", "full"]);
  });
  it("names it Trunk N, skipping names already taken", () => {
    expect(nextTrunkName(["Sapling", "Scout"])).toBe("Trunk 2");
    expect(nextTrunkName(["Sapling", "Trunk 2", "Scout"])).toBe("Trunk 3");
  });
});
