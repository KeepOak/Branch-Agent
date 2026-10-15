import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  answersSection,
  fillAnswerSlots,
  isValidTimeZone,
  machineTimeZone,
  parseFirstRun,
  parseStarter,
  pickStarterTeammates,
  resolveFirstRunAnswers,
  STARTER_OFFER_SIZE,
} from "./trunk-template-first-run.js";
import { parseTrunkTemplate } from "./trunk-template.js";

const BUNDLED = path.resolve(import.meta.dirname, "../../skills/trunk-templates");

function firstRun(overrides: Record<string, unknown> = {}) {
  return {
    questions: [
      { id: "topics", prompt: "Which topics?", default: "Tech news" },
      { id: "watch", prompt: "Anything to watch?", default: "Nothing yet" },
    ],
    timezone: "owner",
    schedule: "paused-until-start",
    result: { title: "Night Shift", summary: "Digest every weekday." },
    ...overrides,
  };
}

function bundledTemplates() {
  return readdirSync(BUNDLED)
    .filter((name) => name.endsWith(".branch.trunk-template.json"))
    .map((name) => {
      const parsed = parseTrunkTemplate(
        JSON.parse(readFileSync(path.join(BUNDLED, name), "utf8")) as unknown,
      );
      if (!parsed.ok) {
        throw new Error(name + ": " + parsed.error);
      }
      return {
        id: name.replace(".branch.trunk-template.json", ""),
        template: parsed.template,
        warnings: parsed.warnings,
      };
    });
}

describe("parseFirstRun", () => {
  it("keeps a contract with two or three questions, the owner's timezone, paused routines and a card", () => {
    const warnings: string[] = [];
    expect(parseFirstRun(firstRun(), warnings)).toEqual(firstRun());
    expect(warnings).toEqual([]);
  });

  it("drops the whole block with one warning when a question has no default", () => {
    const warnings: string[] = [];
    const broken = firstRun({
      questions: [
        { id: "topics", prompt: "Which topics?" },
        { id: "watch", prompt: "Watch?", default: "x" },
      ],
    });
    expect(parseFirstRun(broken, warnings)).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it("refuses one question, four questions, duplicate ids, routines that start on import, and a missing card", () => {
    const q = (id: string) => ({ id, prompt: "Q " + id + "?", default: "d" });
    for (const bad of [
      firstRun({ questions: [q("a")] }),
      firstRun({ questions: [q("a"), q("b"), q("c"), q("d")] }),
      firstRun({ questions: [q("a"), q("a")] }),
      firstRun({ schedule: "on-import" }),
      firstRun({ timezone: "UTC" }),
      firstRun({ result: { title: "x" } }),
    ]) {
      const warnings: string[] = [];
      expect(parseFirstRun(bad, warnings)).toBeUndefined();
      expect(warnings).toHaveLength(1);
    }
  });

  it("says nothing when a template has no first-run block", () => {
    const warnings: string[] = [];
    expect(parseFirstRun(undefined, warnings)).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});

describe("answers", () => {
  it("uses the owner's answer, falls back to the default for empty or missing ones, and ignores unknown ids", () => {
    const contract = parseFirstRun(firstRun(), [])!;
    expect(
      resolveFirstRunAnswers(contract, { topics: "  AI   chips ", watch: "   ", extra: "x" }),
    ).toEqual({
      topics: "AI chips",
      watch: "Nothing yet",
    });
    expect(resolveFirstRunAnswers(contract, undefined)).toEqual({
      topics: "Tech news",
      watch: "Nothing yet",
    });
  });

  it("caps a long answer", () => {
    const contract = parseFirstRun(firstRun(), [])!;
    expect(resolveFirstRunAnswers(contract, { topics: "x".repeat(900) }).topics).toHaveLength(200);
  });

  it("fills {{answers.<id>}} slots and empties unknown ones", () => {
    expect(fillAnswerSlots("Cover {{answers.topics}}; {{answers.nope}}.", { topics: "AI" })).toBe(
      "Cover AI; .",
    );
  });

  it("writes the answers and the timezone as an AGENTS.md section", () => {
    const contract = parseFirstRun(firstRun(), [])!;
    const section = answersSection(
      contract,
      { topics: "AI", watch: "Nothing yet" },
      "Europe/Berlin",
    );
    expect(section).toContain("## Owner's first-run answers");
    expect(section).toContain("- Which topics? AI");
    expect(section).toContain("- Timezone: Europe/Berlin");
  });
});

describe("timezone", () => {
  it("accepts IANA names and refuses anything else", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("reads a valid zone from the machine", () => {
    expect(isValidTimeZone(machineTimeZone())).toBe(true);
  });
});

describe("pickStarterTeammates", () => {
  const candidates = [
    { id: "builder", starter: { pitch: "b", fits: ["code", "app"], rank: 5 } },
    { id: "night-shift", starter: { pitch: "n", fits: ["news", "digest"], rank: 1 } },
    { id: "lookout", starter: { pitch: "l", fits: ["price", "watch"], rank: 4 } },
    { id: "inbox-helper", starter: { pitch: "i", fits: ["email", "inbox"], rank: 2 } },
    { id: "researcher", starter: { pitch: "r", fits: ["research"], rank: 3 } },
  ];

  it("offers exactly three, by rank, when there is no goal", () => {
    expect(pickStarterTeammates(candidates).map((c) => c.id)).toEqual([
      "night-shift",
      "inbox-helper",
      "researcher",
    ]);
  });

  it("puts the teammates that fit the owner's goal first", () => {
    const picked = pickStarterTeammates(
      candidates,
      "I want to build an app and watch competitor prices",
    ).map((c) => c.id);
    expect(picked).toHaveLength(STARTER_OFFER_SIZE);
    expect(picked.slice(0, 2).toSorted()).toEqual(["builder", "lookout"]);
  });

  it("offers fewer only when the catalog has fewer", () => {
    expect(pickStarterTeammates(candidates.slice(0, 2))).toHaveLength(2);
  });

  it("refuses a starter block without a pitch or rank", () => {
    const warnings: string[] = [];
    expect(parseStarter({ fits: ["x"] }, warnings)).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

describe("bundled starter catalog", () => {
  it("ships at least three starters, each with a full first-run contract and no parse warnings", () => {
    const starters = bundledTemplates().filter((entry) => entry.template.starter);
    expect(starters.length).toBeGreaterThanOrEqual(STARTER_OFFER_SIZE);
    for (const entry of starters) {
      expect(entry.warnings, entry.id).toEqual([]);
      expect(entry.template.firstRun, entry.id).toBeDefined();
      expect(entry.template.firstRun?.schedule).toBe("paused-until-start");
      expect(entry.template.firstRun?.questions.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("only fills slots its questions define", () => {
    for (const entry of bundledTemplates()) {
      const ids = new Set(entry.template.firstRun?.questions.map((question) => question.id) ?? []);
      for (const routine of entry.template.automations ?? []) {
        for (const match of routine.prompt.matchAll(/\{\{answers\.([a-z0-9-]+)\}\}/g)) {
          expect(ids.has(match[1] ?? ""), entry.id + " " + match[1]).toBe(true);
        }
      }
    }
  });

  it("has unique ranks so the default offer is stable", () => {
    const ranks = bundledTemplates().flatMap((entry) =>
      entry.template.starter ? [entry.template.starter.rank] : [],
    );
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});
