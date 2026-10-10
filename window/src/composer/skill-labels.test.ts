import { describe, expect, it } from "vitest";
import { readSkills, toggle } from "./tools";

describe("Tools menu skill labels", () => {
  it("shows human names and product renames while keeping raw invocation keys", () => {
    const keys = ["clawhub", "file-receipts"];
    const skills = readSkills({ skills: keys.map((key) => ({ name: key, skillKey: key })) });
    const rows = keys.map((key) => skills.find((skill) => skill.key === key)!);

    expect(rows.map((skill) => skill.name)).toEqual(["Seedbank", "File receipts"]);
    expect(rows.map((skill) => skill.key)).toEqual(keys);
    for (const skill of skills) expect(skill.name).not.toMatch(/claw/i);
    expect(skills.map((skill) => skill.name)).toEqual(["File receipts", "Seedbank"]);
    expect(toggle({}, "skills", rows[0].key, false, true)).toEqual({ skills: { clawhub: false } });
  });

  it("humanises lowercase ids with hyphens or underscores", () => {
    const skills = readSkills({ skills: [{ name: "weekly_report" }, { name: "file-receipts" }] });
    expect(skills.map((skill) => skill.name)).toEqual(["File receipts", "Weekly report"]);
    expect(skills.map((skill) => skill.key)).toEqual(["file-receipts", "weekly_report"]);
  });

  it("preserves display names containing spaces or capitals", () => {
    const names = ["Weekly Report", "File-Receipts", "weekly report"];
    for (const name of names) {
      expect(readSkills({ skills: [{ name, skillKey: "report-key" }] })[0]).toMatchObject({
        name, key: "report-key",
      });
    }
  });

  it("applies product renames to existing display names too", () => {
    expect(readSkills({ skills: [{ name: "ClawHub", skillKey: "clawhub" }] })[0]).toMatchObject({
      name: "Seedbank", key: "clawhub",
    });
  });
});
