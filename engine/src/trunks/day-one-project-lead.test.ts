import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  fillAnswerSlots,
  machineTimeZone,
  pickStarterTeammates,
  resolveFirstRunAnswers,
} from "./trunk-template-first-run.js";
import { parseTrunkTemplate, type TrunkTemplate } from "./trunk-template.js";

// Board card #789: the Project Lead day-one template, built on the first-run contract.
const FILE = path.resolve(
  import.meta.dirname,
  "../../skills/trunk-templates/project-lead.branch.trunk-template.json",
);

function load(): { template: TrunkTemplate; warnings: string[] } {
  const parsed = parseTrunkTemplate(JSON.parse(readFileSync(FILE, "utf8")) as unknown);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return { template: parsed.template, warnings: parsed.warnings };
}

describe("Project Lead first run", () => {
  it("parses cleanly as a bundled starter with two or three questions that all have defaults", () => {
    const { template, warnings } = load();
    expect(warnings).toEqual([]);
    expect(template.name).toBe("Project Lead");
    expect(template.starter?.pitch).toBeTruthy();
    const questions = template.firstRun?.questions ?? [];
    expect(questions.length).toBeGreaterThanOrEqual(2);
    expect(questions.length).toBeLessThanOrEqual(3);
    for (const question of questions) {
      expect(question.default.trim(), question.id).not.toBe("");
    }
    expect(template.firstRun?.result.title).toBe("Project Lead");
  });

  it("is listed under the id Seedbank and onboarding step 4 add it by", () => {
    expect(path.basename(FILE)).toBe("project-lead.branch.trunk-template.json");
  });
});

describe("Project Lead scheduled run", () => {
  it("has one daily status pass, filled from the default answers, in the owner's timezone and paused until Start", () => {
    const { template } = load();
    expect(template.automations).toHaveLength(1);
    const routine = template.automations![0]!;
    expect(routine.name).toBe("Daily status pass");
    expect(routine.cron).toBe("0 9 * * *");
    expect(template.firstRun?.timezone).toBe("owner");
    expect(template.firstRun?.schedule).toBe("paused-until-start");
    expect(machineTimeZone()).toBeTruthy();

    const answers = resolveFirstRunAnswers(template.firstRun!, undefined);
    const prompt = fillAnswerSlots(routine.prompt, answers);
    expect(prompt).not.toContain("{{");
    expect(prompt).toContain("A new Projects group");
    expect(prompt).toContain("I'll name them in chat");
    expect(prompt).toContain("Any Trunk on my team whose job fits the task");

    const owned = fillAnswerSlots(
      routine.prompt,
      resolveFirstRunAnswers(template.firstRun!, { projects: "Spring launch" }),
    );
    expect(owned).toContain("Spring launch");
  });

  it("does not push out the default three-teammate offer", () => {
    const { template } = load();
    const ranks = [1, 2, 3].map((rank) => ({
      id: "r" + rank,
      starter: { pitch: "p", fits: [], rank },
    }));
    const offer = pickStarterTeammates([...ranks, { id: "project-lead", starter: template.starter! }]);
    expect(offer.map((entry) => entry.id)).toEqual(["r1", "r2", "r3"]);
    expect(
      pickStarterTeammates([...ranks, { id: "project-lead", starter: template.starter! }], "run my team projects")[0]
        ?.id,
    ).toBe("project-lead");
  });
});

describe("Project Lead approvals", () => {
  it("holds every send, spend, sign or post for the owner's yes", () => {
    const { template } = load();
    const persona = template.persona.agentsMd;
    const never = persona.slice(persona.indexOf("## Never"));
    expect(never).toContain("Never do the specialist work yourself");
    expect(never).toContain("Never close, archive or mark a project done without the owner's yes");
    expect(never).toMatch(/Never send, post, spend, buy or sign anything that leaves Branch on your own/);
    expect(never).toContain("every send, spend, sign or post waits for the owner's yes");
    expect(template.permissions.join("\n")).toContain(
      "Ask first: every send, spend, sign or post that leaves Branch waits for the owner's yes.",
    );
    expect(template.automations![0]!.prompt).toContain("ask first before anything leaves Branch");
  });

  it("keeps only the tools its job needs: messaging and sessions on, everything that reaches outside off", () => {
    const { template } = load();
    expect(template.toolsets).toMatchObject({ messaging: true, sessions: true });
    for (const off of ["browser", "files", "shell", "computer", "web", "github", "media", "automation", "secrets"]) {
      expect(template.toolsets[off], off).toBe(false);
    }
    expect(template.skills).toEqual([]);
    expect(template.connections).toBeUndefined();
  });
});
