import { describe, expect, it } from "vitest";
import { displayName, engineInvocation, invocationName, skillPickText } from "./display-names";
import { visible } from "./places/settings/adapter";
import { readSkillRows, skillInstallParams } from "./places/customize/skills";

const PRODUCT_PAIRS: Array<[string, string]> = [
  ["OpenClaw", "Branch"],
  ["Crabbox", "Cuttings"],
  ["ClawHub", "Seedbank"],
  ["clawhub", "Seedbank"],
  ["Peekaboo", "Knothole"],
  ["Lobsterdex", "Trellis index"],
  ["Lobster", "Trellis"],
  ["ClawRouter", "Model router"],
  ["ClawSweeper", "Rake"],
  ["clawpack", "Seedpod"],
  ["Molty", "Sprig"],
  ["Workboard", "Canopy"],
  ["Dreaming", "Rings"],
];

describe("displayName: exact engine identifiers only", () => {
  it("maps each whole engine identifier to its Branch name, in any case", () => {
    for (const [raw, shown] of PRODUCT_PAIRS) {
      expect(displayName(raw)).toBe(shown);
      expect(displayName(raw.toUpperCase())).toBe(shown);
    }
  });

  it("leaves free text alone, so a sentence keeps its ordinary words", () => {
    expect(displayName("I was dreaming about it")).toBe("I was dreaming about it");
    expect(displayName("Dreaming on")).toBe("Dreaming on");
    expect(displayName("Keeps OpenClaw Dreaming notes")).toBe("Keeps OpenClaw Dreaming notes");
  });

  it("does not rely on object keys, so prototype names pass through", () => {
    expect(displayName("constructor")).toBe("constructor");
    expect(displayName("toString")).toBe("toString");
  });

  it("returns ordinary labels unchanged", () => {
    expect(displayName("Weekly report")).toBe("Weekly report");
    expect(displayName("")).toBe("");
  });
});

describe("skill invocations", () => {
  it("shows a skill as the lower-case display name, and leaves other names as they are", () => {
    expect(invocationName("clawhub")).toBe("seedbank");
    expect(invocationName("file-receipts")).toBe("file-receipts");
  });

  it("a pick anywhere in the message runs as the engine key", () => {
    const typed = `${skillPickText("clawhub")} find invoices`;
    expect(typed).toContain("/seedbank");
    expect(engineInvocation(typed, ["clawhub"])).toBe("/clawhub find invoices");
  });

  it("a pick in the middle of a sentence runs as the engine key", () => {
    const typed = `before you start, ${skillPickText("clawhub")} now`;
    expect(engineInvocation(typed, ["clawhub"])).toBe("before you start, /clawhub now");
  });

  it("a typed leading /seedbank runs as the engine key", () => {
    expect(engineInvocation("/seedbank summarize this", ["clawhub"])).toBe("/clawhub summarize this");
    expect(engineInvocation("/seedbank", ["clawhub"])).toBe("/clawhub");
  });

  it("prose that mentions /seedbank without a pick is sent unchanged", () => {
    expect(engineInvocation("please use /seedbank now", ["clawhub"])).toBe("please use /seedbank now");
    expect(engineInvocation("ask the seedbank team", ["clawhub"])).toBe("ask the seedbank team");
  });

  it("a typed mid-message /seedbank after a pick is prose and stays as written", () => {
    const typed = `${skillPickText("clawhub")} then tell me about /seedbank`;
    expect(engineInvocation(typed, ["clawhub"])).toBe("/clawhub then tell me about /seedbank");
  });

  it("keeps /clawhub working as a hidden alias", () => {
    expect(engineInvocation("/clawhub summarize this", ["clawhub"])).toBe("/clawhub summarize this");
  });

  it("never leaves the invisible pick mark in the text the engine receives", () => {
    const out = engineInvocation(`${skillPickText("clawhub")}⁠ ok`, ["clawhub"]);
    expect(out).not.toMatch(/⁠/);
  });
});

describe("settings values go through the same rule", () => {
  it("visible() renders an exact engine identifier as its Branch name", () => {
    expect(visible("ClawHub")).toBe("Seedbank");
    expect(visible("Dreaming")).toBe("Rings");
  });

  it("visible() leaves free text unchanged", () => {
    expect(visible("Dreaming on")).toBe("Dreaming on");
  });
});

describe("Customize > Skills", () => {
  it("shows Seedbank for a clawhub skill and keeps the raw key for engine calls", () => {
    const [row] = readSkillRows({
      skills: [{ name: "clawhub", skillKey: "clawhub", description: "Find skills in the ClawHub catalog" }],
    });
    expect(row).toMatchObject({ key: "clawhub", rawName: "clawhub", name: "Seedbank" });
    expect(row.name).not.toMatch(/claw/i);
  });

  it("leaves a skill description as written", () => {
    const [row] = readSkillRows({
      skills: [{ name: "night-notes", skillKey: "night-notes", description: "Keeps OpenClaw Dreaming notes" }],
    });
    expect(row.description).toBe("Keeps OpenClaw Dreaming notes");
  });

  it("sends the raw skill name to skills.install, never the display name", () => {
    const [row] = readSkillRows({
      skills: [{ name: "clawhub", skillKey: "clawhub", install: [{ id: "install-1", label: "Install" }] }],
    });
    expect(row.name).toBe("Seedbank");
    expect(skillInstallParams({ agentId: "sapling" }, row, "install-1")).toEqual({
      agentId: "sapling",
      name: "clawhub",
      installId: "install-1",
    });
  });
});
