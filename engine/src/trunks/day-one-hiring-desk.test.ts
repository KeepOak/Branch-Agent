import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fillAnswerSlots, pickStarterTeammates, resolveFirstRunAnswers } from "./trunk-template-first-run.js";
import { parseTrunkTemplate, type TrunkTemplate } from "./trunk-template.js";

// Board card #793: the Hiring Desk day-one template, built on the first-run contract (#1304).
const FILE = path.resolve(import.meta.dirname, "../../skills/trunk-templates/hiring-desk.branch.trunk-template.json");

function load(): { template: TrunkTemplate; warnings: string[] } {
  const parsed = parseTrunkTemplate(JSON.parse(readFileSync(FILE, "utf8")) as unknown);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return { template: parsed.template, warnings: parsed.warnings };
}

describe("Hiring Desk first run", () => {
  it("parses cleanly as a bundled starter with two or three questions that all have defaults", () => {
    const { template, warnings } = load();
    expect(warnings).toEqual([]);
    expect(template.name).toBe("Hiring Desk");
    const questions = template.firstRun?.questions ?? [];
    expect(questions.length).toBeGreaterThanOrEqual(2);
    expect(questions.length).toBeLessThanOrEqual(3);
    for (const question of questions) {
      expect(question.default.trim(), question.id).not.toBe("");
    }
    expect(template.firstRun?.timezone).toBe("owner");
    expect(template.firstRun?.schedule).toBe("paused-until-start");
    expect(template.firstRun?.result.title).toBe("Hiring Desk");
  });

  it("is listed under the id Seedbank and onboarding step 4 add it by", () => {
    expect(path.basename(FILE)).toBe("hiring-desk.branch.trunk-template.json");
  });
});

describe("Hiring Desk scheduled run", () => {
  it("has one weekday follow-up pass, filled from the default answers, that drafts and never sends", () => {
    const { template } = load();
    expect(template.automations?.map((routine) => [routine.name, routine.cron])).toEqual([
      ["Daily hiring follow-up", "0 10 * * 1-5"],
    ]);
    const prompt = fillAnswerSlots(template.automations![0]!.prompt, resolveFirstRunAnswers(template.firstRun!, undefined));
    expect(prompt).not.toContain("{{");
    expect(prompt).toContain("Feedback is due within: One working day");
    expect(prompt).toContain("Send, book or share nothing without the owner's yes.");
    const named = fillAnswerSlots(
      template.automations![0]!.prompt,
      resolveFirstRunAnswers(template.firstRun!, { roles: "Senior designer" }),
    );
    expect(named).toContain("Roles: Senior designer");
  });

  it("does not push out the default three-teammate offer, and leads when the goal is hiring", () => {
    const { template } = load();
    const ranks = [1, 2, 3].map((rank) => ({ id: "r" + rank, starter: { pitch: "p", fits: [], rank } }));
    const entries = [...ranks, { id: "hiring-desk", starter: template.starter! }];
    expect(pickStarterTeammates(entries).map((entry) => entry.id)).toEqual(["r1", "r2", "r3"]);
    expect(pickStarterTeammates(entries, "help me schedule interviews for a hiring push")[0]?.id).toBe("hiring-desk");
  });
});

describe("Hiring Desk holds every outbound action for the owner", () => {
  it("states the card's anti-job and the ask-first rule", () => {
    const { template } = load();
    const persona = template.persona.agentsMd;
    const never = persona.split("## Never")[1] ?? "";
    expect(never).toContain("Never email or message a candidate without the owner's yes.");
    expect(never).toContain("Never make or share a hiring decision");
    expect(persona).toContain("Every send, spend, sign or post waits for the owner.");
    expect(persona).toContain("adding, moving or cancelling a calendar event");
    expect(template.permissions.join("\n")).toContain("Ask first: every send, spend, sign or post waits for your yes.");
  });

  it("keeps only files on, with nothing that sends or reaches outside", () => {
    const { template } = load();
    expect(template.toolsets).toMatchObject({ files: true });
    for (const off of ["web", "browser", "shell", "computer", "messaging", "github", "media", "automation", "secrets"]) {
      expect(template.toolsets[off], off).toBe(false);
    }
    expect(template.skills).toEqual([]);
    expect(template.connections).toBeUndefined();
  });
});
