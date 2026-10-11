import { describe, expect, it } from "vitest";
import {
  TRUNK_NAME_DEFAULT,
  TRUNK_NAME_REQUIRED,
  TRUNK_NAME_TAKEN,
  isDefaultTrunkName,
  trunkNameProblem,
  trunkNamesInUse,
} from "./trunk-name-rule.js";

describe("trunk name rule", () => {
  it.each(["New Trunk", "new  trunk 2", " Trunk 12 ", "7"])("treats %s as a default name", (name) => {
    expect(isDefaultTrunkName(name)).toBe(true);
    expect(trunkNameProblem(name, new Set())).toEqual({
      reason: "invalid-name",
      message: TRUNK_NAME_DEFAULT,
    });
  });

  it.each(["Maple", "Trunk", "New Trunk Ash", "Agent 7"])("allows %s", (name) => {
    expect(isDefaultTrunkName(name)).toBe(false);
    expect(trunkNameProblem(name, new Set())).toBeUndefined();
  });

  it("requires a name", () => {
    expect(trunkNameProblem("   ", new Set())?.message).toBe(TRUNK_NAME_REQUIRED);
  });

  it("collects every id, configured name and shown name except the excluded Trunk", () => {
    const used = trunkNamesInUse(
      [
        { id: "researcher", name: "Scout", identity: { name: "Quill" } },
        { id: "ash", identity: { name: "Ash  Tree" } },
        { id: "self", name: "Maple" },
      ],
      "self",
    );
    expect([...used].sort()).toEqual(["ash", "ash tree", "quill", "researcher", "scout"]);
    expect(trunkNameProblem(" ASH tree ", used)).toEqual({
      reason: "already-exists",
      message: TRUNK_NAME_TAKEN,
    });
    expect(trunkNameProblem("Maple", used)).toBeUndefined();
  });
});
