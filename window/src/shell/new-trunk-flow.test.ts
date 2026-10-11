import { describe, expect, it } from "vitest";
import { CARE, FIRST_JOB } from "./NewTrunkFlow";

describe("New Trunk", () => {
  it("asks the artifact's questions", () => {
    expect(FIRST_JOB.map((o) => o.label)).toEqual(["Inbox & calendar", "Money & receipts", "Research", "Files on this computer", "Something else"]);
    expect(CARE.map((o) => o.mode)).toEqual(["guarded", "workspace", "full"]);
  });
});
