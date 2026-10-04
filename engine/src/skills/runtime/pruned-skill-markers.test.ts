import { describe, expect, it } from "vitest";
import {
  collectGhostedSkillNames,
  collectProtectedSkillNames,
  extractPrunedSkillNames,
  reinjectPrunedSkillMarkers,
  skillPrunedMarker,
  skillReadCallSites,
} from "./pruned-skill-markers.js";

function pair(name: string, text = "x".repeat(6000)) {
  return [
    {
      role: "assistant",
      content: [{ type: "toolCall", id: `call-${name}`, name: "skills_read", arguments: { name } }],
    },
    {
      role: "toolResult",
      toolCallId: `call-${name}`,
      toolName: "skills_read",
      content: [{ type: "text", text }],
    },
  ];
}

describe("Hermes ghost-skill defense", () => {
  it("round-trips canonical markers and exact quoted names", () => {
    for (const name of ["pdf", "someone's skill", 'quotes " [] \\']) {
      expect(extractPrunedSkillNames(skillPrunedMarker(name))).toEqual([name]);
    }
  });

  it("restores paraphrased markers and reinjects only missing markers", () => {
    const out = reinjectPrunedSkillMarkers(`body\n${skillPrunedMarker("alpha")}`, [
      "alpha",
      "beta",
    ]);
    expect(out.split(skillPrunedMarker("alpha"))).toHaveLength(2);
    expect(out.split(skillPrunedMarker("beta"))).toHaveLength(2);
    expect(out).toContain("## Pruned Skills");
    expect(reinjectPrunedSkillMarkers(out, ["alpha", "beta"])).toBe(out);
  });

  it("collects markers and large skill reads while preserving the source 5000-character boundary", () => {
    const messages = [
      ...pair("pdf"),
      ...pair("small", "x".repeat(5000)),
      { role: "user", content: skillPrunedMarker("already-pruned") },
    ];
    expect(collectGhostedSkillNames(messages)).toEqual(["pdf", "already-pruned"]);
    expect(skillReadCallSites(messages).map((site) => site.name)).toEqual(["pdf", "small"]);
  });

  it("protects recent loads, protected-tail loads, and skills named by a tail user message", () => {
    const messages = [
      ...pair("older"),
      ...pair("mentioned"),
      ...Array.from({ length: 12 }, () => ({ role: "assistant", content: [] })),
      ...pair("fresh"),
      { role: "user", content: "Continue using MENTIONED." },
    ];
    expect([...collectProtectedSkillNames(messages, 16)]).toEqual(["mentioned", "fresh"]);
  });

  it("keeps the source first-20 bound at collection sites without inventing a smaller cap", () => {
    const names = Array.from({ length: 25 }, (_, index) => `skill-${index}`);
    const out = reinjectPrunedSkillMarkers("body", names.slice(0, 20));
    expect(extractPrunedSkillNames(out)).toEqual(names.slice(0, 20));
  });

  it("forces source-equivalent secret redaction on reinjected blocks", () => {
    const secret = "ghp_" + "a1B2".repeat(6);
    expect(reinjectPrunedSkillMarkers("body", [`x ${secret}`])).not.toContain(secret);
  });

  it("ignores malformed/non-skill calls and never fabricates a reload target", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "not-skill", name: "read", arguments: { path: "SKILL.md" } },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "not-skill",
        toolName: "read",
        content: [{ type: "text", text: "x".repeat(6000) }],
      },
    ];
    expect(collectGhostedSkillNames(messages)).toEqual([]);
  });

  it("uses Python character counting so Unicode skills have no stricter prune threshold", () => {
    expect(collectGhostedSkillNames(pair("unicode", "😀".repeat(5000)))).toEqual([]);
    expect(collectGhostedSkillNames(pair("unicode", "😀".repeat(5001)))).toEqual(["unicode"]);
  });
});
