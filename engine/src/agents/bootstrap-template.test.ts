import fs from "node:fs";
import { describe, expect, it } from "vitest";

const template = fs.readFileSync(
  new URL("../../docs/reference/templates/BOOTSTRAP.md", import.meta.url),
  "utf8",
);

function headings(): string[] {
  return [...template.matchAll(/^## \d\. (.+)$/gm)].map((match) => match[1] ?? "");
}

describe("BOOTSTRAP.md first-run beats", () => {
  it("asks the owner's order: how they are, names, then the goal", () => {
    expect(headings()).toEqual([
      "Say Hi and Learn Their Name",
      "Name Yourself",
      "Learn the Goal",
      "Choose Your Vibe",
      "Choose Your Avatar",
      "Finish With Recommendations",
    ]);
  });

  it("asks one question per message and keeps answers out of files until the save step", () => {
    expect(template).toContain("one question per message");
    expect(template).toContain("write nothing early");
    expect(template).not.toMatch(/invent, or suggest a name/);
  });

  it("tells the Trunk to draft the team with team_propose once it knows the goal", () => {
    const goal = template.indexOf("## 3. Learn the Goal");
    const next = template.indexOf("## 4.");
    const step = template.slice(goal, next);
    expect(step).toContain("`team_propose`");
    expect(step).toContain("1 to 5");
  });

  it("saves the owner name, goal, and the Trunk's name in one turn after the goal is known", () => {
    const goal = template.indexOf("## 3. Learn the Goal");
    const save = template.indexOf("### Save Everything");
    const done = template.indexOf("## Done");
    expect(goal).toBeGreaterThan(0);
    expect(save).toBeGreaterThan(goal);
    expect(done).toBeGreaterThan(save);
    const saveStep = template.slice(save, done);
    expect(saveStep).toContain("`USER.md`");
    expect(saveStep).toContain("Always address the owner as");
    expect(saveStep).toContain("`MEMORY.md`");
    expect(saveStep).toContain("`IDENTITY.md`");
  });
});
