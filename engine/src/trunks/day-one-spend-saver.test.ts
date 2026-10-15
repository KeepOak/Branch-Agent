import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fillAnswerSlots, pickStarterTeammates, resolveFirstRunAnswers } from "./trunk-template-first-run.js";
import { parseTrunkTemplate, type TrunkTemplate } from "./trunk-template.js";

// Board card #792: the Spend Saver day-one template, built on the first-run contract (#1304).
const FILE = path.resolve(import.meta.dirname, "../../skills/trunk-templates/spend-saver.branch.trunk-template.json");

function load(): { template: TrunkTemplate; warnings: string[] } {
  const parsed = parseTrunkTemplate(JSON.parse(readFileSync(FILE, "utf8")) as unknown);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return { template: parsed.template, warnings: parsed.warnings };
}

describe("Spend Saver first run", () => {
  it("parses cleanly as a bundled starter with two or three questions that all have defaults", () => {
    const { template, warnings } = load();
    expect(warnings).toEqual([]);
    expect(template.name).toBe("Spend Saver");
    const questions = template.firstRun?.questions ?? [];
    expect(questions.length).toBeGreaterThanOrEqual(2);
    expect(questions.length).toBeLessThanOrEqual(3);
    for (const question of questions) {
      expect(question.default.trim(), question.id).not.toBe("");
    }
    expect(template.firstRun?.timezone).toBe("owner");
    expect(template.firstRun?.schedule).toBe("paused-until-start");
    expect(template.firstRun?.result.title).toBe("Spend Saver");
  });

  it("is listed under the id Seedbank and onboarding step 4 add it by", () => {
    expect(path.basename(FILE)).toBe("spend-saver.branch.trunk-template.json");
  });
});

describe("Spend Saver scheduled run", () => {
  it("has one monthly review, filled from the default answers, that drafts and never acts", () => {
    const { template } = load();
    expect(template.automations?.map((routine) => [routine.name, routine.cron])).toEqual([
      ["Monthly spend review", "0 9 1 * *"],
    ]);
    const prompt = fillAnswerSlots(template.automations![0]!.prompt, resolveFirstRunAnswers(template.firstRun!, undefined));
    expect(prompt).not.toContain("{{");
    expect(prompt).toContain("My email receipts and a bills folder in my files");
    expect(prompt).toContain("Software and streaming subscriptions");
    expect(prompt).toContain("Send, spend, sign or cancel nothing without the owner's yes.");
    const kept = fillAnswerSlots(
      template.automations![0]!.prompt,
      resolveFirstRunAnswers(template.firstRun!, { keep: "Our design tool" }),
    );
    expect(kept).toContain("Keep current plans for: Our design tool");
  });

  it("does not push out the default three-teammate offer, and leads when the goal is saving money", () => {
    const { template } = load();
    const ranks = [1, 2, 3].map((rank) => ({ id: "r" + rank, starter: { pitch: "p", fits: [], rank } }));
    const entries = [...ranks, { id: "spend-saver", starter: template.starter! }];
    expect(pickStarterTeammates(entries).map((entry) => entry.id)).toEqual(["r1", "r2", "r3"]);
    expect(pickStarterTeammates(entries, "cut my software subscriptions")[0]?.id).toBe("spend-saver");
  });
});

describe("Spend Saver holds every outbound action for the owner", () => {
  it("states the card's anti-jobs and the ask-first rule", () => {
    const persona = load().template.persona.agentsMd;
    const never = persona.split("## Never")[1] ?? "";
    expect(never).toContain("Never spend, buy, upgrade or pay for anything.");
    expect(never).toContain("Never sign, accept or agree to any offer");
    expect(never).toContain("Never cancel, downgrade or change a subscription or account yourself.");
    expect(never).toContain("Never send, post or reply to a vendor without the owner's yes.");
    expect(persona).toContain("Every send, spend, sign or post waits for the owner.");
    expect(load().template.permissions.join("\n")).toContain("Ask first: every send, spend, sign or post waits for your yes.");
  });

  it("keeps only files and web search on", () => {
    const { template } = load();
    expect(template.toolsets).toMatchObject({ files: true, web: true });
    for (const off of ["browser", "shell", "computer", "messaging", "github", "media", "automation", "secrets"]) {
      expect(template.toolsets[off], off).toBe(false);
    }
    expect(template.skills).toEqual([]);
    expect(template.connections).toBeUndefined();
  });
});
