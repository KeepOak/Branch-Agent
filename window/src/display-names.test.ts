import { describe, expect, it } from "vitest";
import { displayName } from "./display-names";
import { visible } from "./places/settings/adapter";
import { readSkillRows } from "./places/customize/skills";

const RAW_ENGINE_NAMES = ["OpenClaw", "Dreaming", "Lobster", "Lobsterdex", "clawhub", "ClawHub", "clawpack", "Crabbox", "Molty", "Workboard", "Peekaboo", "ClawRouter", "ClawSweeper"];

describe("one display-name map", () => {
  it("maps each engine product name to its Branch name", () => {
    expect(displayName("clawhub")).toBe("Seedbank");
    expect(displayName("ClawHub")).toBe("Seedbank");
    expect(displayName("Dreaming")).toBe("Seasons");
    expect(displayName("OpenClaw")).toBe("Branch");
    expect(displayName("Lobster")).toBe("Trellis");
    expect(displayName("Lobsterdex")).toBe("Trellis index");
    expect(displayName("clawpack")).toBe("Seedpod");
  });

  it("leaves text without an engine name unchanged", () => {
    expect(displayName("Weekly report")).toBe("Weekly report");
    expect(displayName("")).toBe("");
  });

  it("is not an identity function: every raw engine name changes", () => {
    for (const raw of RAW_ENGINE_NAMES) {
      expect(displayName(raw)).not.toBe(raw);
    }
  });

  it("never lets a raw engine name through", () => {
    for (const raw of RAW_ENGINE_NAMES) {
      expect(displayName(`Uses ${raw} for planning.`)).not.toMatch(/OpenClaw|Dreaming|Lobster|claw|Molty|Workboard|Crabbox|Peekaboo/i);
    }
  });
});

describe("settings values go through the same map", () => {
  it("visible() renders engine product names as Branch names", () => {
    expect(visible("ClawHub")).toBe("Seedbank");
    expect(visible("Dreaming on")).toBe("Seasons on");
  });
});

describe("Customize > Skills rows use the same map for display", () => {
  it("shows Seedbank for a clawhub skill and keeps the raw key and name for engine calls", () => {
    const [row] = readSkillRows({
      skills: [{ name: "clawhub", skillKey: "clawhub", description: "Find skills in the Seedbank catalog" }],
    });
    expect(row).toMatchObject({ key: "clawhub", rawName: "clawhub", name: "Seedbank" });
    expect(row.name).not.toMatch(/claw/i);
    expect(row.description).toBe("Find skills in the Seedbank catalog");
  });

  it("maps dreaming and OpenClaw in skill descriptions and never shows them raw", () => {
    const [row] = readSkillRows({
      skills: [{ name: "night-notes", skillKey: "night-notes", description: "Keeps OpenClaw Dreaming notes" }],
    });
    expect(row.description).toBe("Keeps Branch Seasons notes");
    expect(row.description).not.toMatch(/OpenClaw|Dreaming/);
  });
});
