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
      "Offer Three Starter Teammates",
      "Finish With Recommendations",
    ]);
  });

  it("asks one question per message and keeps answers out of files until the save step", () => {
    expect(template).toContain("one question per message");
    expect(template).toContain("write nothing early");
    expect(template).not.toMatch(/invent, or suggest a name/);
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

  it("offers three starter teammates in the first conversation and starts one only after the owner's yes", () => {
    const save = template.indexOf("### Save Everything");
    const offer = template.indexOf("## 6. Offer Three Starter Teammates");
    const recommendations = template.indexOf("## 7. Finish With Recommendations");
    expect(offer).toBeGreaterThan(save);
    expect(recommendations).toBeGreaterThan(offer);
    const beat = template.slice(offer, recommendations);
    expect(beat).toContain('branch trunks starters --agent "<this agent id>"');
    expect(beat).toContain("offer all\nthree teammates in one message");
    expect(beat).toContain("--answer");
    expect(beat).toContain("--timezone");
    const ask = beat.indexOf("Start it now?");
    const start = beat.indexOf("branch trunks start ");
    expect(ask).toBeGreaterThan(0);
    expect(start).toBeGreaterThan(ask);
    expect(beat).toContain("Never start a teammate the owner did not say yes to.");
  });

  it("keeps the old recommendations anchor so existing links still land", () => {
    expect(template).toContain('<a id="6-finish-with-recommendations" />');
  });
});
