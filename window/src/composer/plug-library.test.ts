import { describe, expect, it } from "vitest";
import { libraryLists } from "./PlugMenu";
import { toggle, type SkillRow } from "./tools";

const skills: SkillRow[] = [
  { key: "meeting-notes", name: "meeting-notes", line: "", baseEnabled: true },
  { key: "trip-notes", name: "trip-notes", line: "", baseEnabled: false },
  { key: "search", name: "search", line: "", baseEnabled: true, problem: "Needs a key" },
];

describe("the plug's library", () => {
  it("splits skills chosen here from the ones to add, leaving out ones that can't run", () => {
    const { chosen, rest } = libraryLists(skills, {});
    expect(chosen.map((s) => s.key)).toEqual(["meeting-notes"]);
    expect(rest.map((s) => s.key)).toEqual(["trip-notes"]);
  });
  it("Add switches a skill on for this conversation only", () => {
    const next = toggle({}, "skills", "trip-notes", true, false);
    expect(next.skills).toEqual({ "trip-notes": true });
    expect(libraryLists(skills, next).chosen.map((s) => s.key)).toEqual(["meeting-notes", "trip-notes"]);
  });
});
