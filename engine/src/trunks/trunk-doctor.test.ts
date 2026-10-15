import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLSETS } from "../agents/tool-toolsets.js";
import { fillAnswerSlots, pickStarterTeammates, resolveFirstRunAnswers } from "./trunk-template-first-run.js";
import { parseTrunkTemplate, type TrunkTemplate } from "./trunk-template.js";

// Board card #786: the Trunk Doctor day-one template, built on the first-run contract (#1304).
const FILE = path.resolve(import.meta.dirname, "../../skills/trunk-templates/trunk-doctor.branch.trunk-template.json");

function load(): { template: TrunkTemplate; warnings: string[] } {
  const parsed = parseTrunkTemplate(JSON.parse(readFileSync(FILE, "utf8")) as unknown);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return { template: parsed.template, warnings: parsed.warnings };
}

/** The tools a Trunk made from this template actually gets: its toolsets on, minus denyTools. */
function grantedTools(template: TrunkTemplate): Set<string> {
  const deny = new Set(template.denyTools ?? []);
  return new Set(
    TOOLSETS.filter((toolset) => template.toolsets[toolset.id] === true)
      .flatMap((toolset) => toolset.tools)
      .filter((tool) => !deny.has(tool)),
  );
}

describe("Trunk Doctor first run", () => {
  it("parses cleanly as a bundled starter with two or three questions that all have defaults", () => {
    const { template, warnings } = load();
    expect(warnings).toEqual([]);
    expect(template.name).toBe("Trunk Doctor");
    const questions = template.firstRun?.questions ?? [];
    expect(questions.length).toBeGreaterThanOrEqual(2);
    expect(questions.length).toBeLessThanOrEqual(3);
    for (const question of questions) {
      expect(question.default.trim(), question.id).not.toBe("");
    }
    expect(template.firstRun?.timezone).toBe("owner");
    expect(template.firstRun?.schedule).toBe("paused-until-start");
    expect(template.firstRun?.result.title).toBe("Trunk Doctor");
  });

  it("does not write its own routines or first-run script: the contract does both", () => {
    const { template } = load();
    const persona = template.persona.agentsMd;
    expect(persona).not.toContain("## First run");
    expect(persona).not.toContain("## Schedules");
    expect(persona).not.toMatch(/automations tool/);
  });

  it("states the anti-jobs from the card", () => {
    const never = load().template.persona.agentsMd.split("## Never")[1] ?? "";
    expect(never).toContain("Never create, change, rename, pause or delete a Trunk without the owner's clear yes");
    expect(never).toContain("Never publish a seed");
    expect(never).toContain("Never message, steer or instruct another Trunk");
  });
});

describe("Trunk Doctor scheduled runs", () => {
  it("has a weekday friction scan and a Monday waste audit, filled from the default answers, that stay silent with nothing to report", () => {
    const { template } = load();
    expect(template.automations?.map((routine) => [routine.name, routine.cron])).toEqual([
      ["Trunk Doctor: friction scan", "30 17 * * 1-5"],
      ["Trunk Doctor: waste audit", "0 9 * * 1"],
    ]);
    const answers = resolveFirstRunAnswers(template.firstRun!, undefined);
    for (const routine of template.automations!) {
      const prompt = fillAnswerSlots(routine.prompt, answers);
      expect(prompt).not.toContain("{{");
      expect(prompt).toContain("Every Trunk on my team");
      expect(prompt).toContain("reply with exactly NO_REPLY");
      expect(prompt).toContain("change nothing until the owner names the fixes");
    }
    const scoped = fillAnswerSlots(
      template.automations![0]!.prompt,
      resolveFirstRunAnswers(template.firstRun!, { "leave-alone": "Ledger" }),
    );
    expect(scoped).toContain("Leave alone: Ledger");
  });

  it("does not push out the default three-teammate offer, and leads when the goal is the team", () => {
    const { template } = load();
    const ranks = [1, 2, 3].map((rank) => ({ id: "r" + rank, starter: { pitch: "p", fits: [], rank } }));
    const entries = [...ranks, { id: "trunk-doctor", starter: template.starter! }];
    expect(pickStarterTeammates(entries).map((entry) => entry.id)).toEqual(["r1", "r2", "r3"]);
    expect(pickStarterTeammates(entries, "check my team of trunks for waste")[0]?.id).toBe("trunk-doctor");
  });
});

describe("Trunk Doctor holds every outbound action for the owner", () => {
  it("gets no tool that sends, steers or spawns sessions, changes the gateway or installs plugins", () => {
    const granted = grantedTools(load().template);
    for (const tool of ["sessions_send", "trunk_message", "sessions", "sessions_spawn", "subagents", "gateway", "plugins", "automations"]) {
      expect(granted.has(tool), tool).toBe(false);
    }
    for (const tool of ["sessions_list", "sessions_history", "agents_list", "branch"]) {
      expect(granted.has(tool), tool).toBe(true);
    }
  });

  it("keeps everything that reaches outside off", () => {
    const { template } = load();
    for (const off of ["browser", "shell", "computer", "web", "github", "media", "messaging", "secrets"]) {
      expect(template.toolsets[off], off).toBe(false);
    }
  });

  it("asks first for every send, spend, sign or post, and makes Trunks only through Branch's approval", () => {
    const { template } = load();
    expect(template.persona.agentsMd).toContain("Every send, spend, sign or post waits for the owner's yes.");
    expect(template.persona.agentsMd).toContain("Ask \"Make it?\" and wait.");
    expect(template.permissions.join("\n")).toContain("Ask first: every send, spend, sign or post waits for your yes.");
  });
});

describe("denyTools in the template format", () => {
  it("keeps known tool names and warns on the rest", () => {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;
    const parsed = parseTrunkTemplate({ ...raw, denyTools: ["sessions_spawn", "not_a_tool"] });
    expect(parsed.ok && parsed.template.denyTools).toEqual(["sessions_spawn"]);
    expect(parsed.ok && parsed.warnings).toEqual(["One denyTools entry names no built-in tool and was skipped."]);
  });
});
