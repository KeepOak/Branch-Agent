import { describe, expect, it } from "vitest";
import { buildSkillResourceGraph } from "./resource-graph.js";
import { extractSkillReferences } from "./resource-references.js";

describe("DeerFlow resource graph port", () => {
  it("tracks resources, missing links, escaping links, and unreferenced files", () => {
    const graph = buildSkillResourceGraph({
      "SKILL.md":
        "Read [guide](references/guide.md). Read `references/missing.md` and `../outside.md`.",
      "references/guide.md": "# Guide",
      "references/unused.md": "# Unused",
      "evals/evals.json": "{}",
      "evals/fixtures/partial/SKILL.md": "[bad](missing.md)",
    });
    expect(graph.edges).toEqual([{ source: "SKILL.md", target: "references/guide.md" }]);
    expect(graph.orphans).toEqual(["references/unused.md"]);
    expect(graph.findings.map((finding) => finding.ruleId)).toEqual([
      "resource.missing",
      "resource.escaping-link",
      "resource.unreferenced",
    ]);
  });

  it("keeps real dotted and hash paths, resolving nested sources before literal-path lookup", () => {
    const graph = buildSkillResourceGraph({
      "SKILL.md":
        "Read references/v1.0.md. Also references/setup.md! and `references/C#/readme.md`.",
      "references/sub/guide.md": "See `../C#.md` and `../faq.md#/../other.md`.",
      "references/v1.0.md": "",
      "references/setup.md": "",
      "references/C#/readme.md": "",
      "references/C#.md": "",
      "references/faq.md": "",
      "references/other.md": "",
    });
    expect(graph.edges).toContainEqual({
      source: "references/sub/guide.md",
      target: "references/C#.md",
    });
    expect(graph.edges).toContainEqual({
      source: "references/sub/guide.md",
      target: "references/faq.md",
    });
    expect(graph.findings.some((finding) => finding.ruleId === "resource.missing")).toBe(false);
  });

  it("always strips markdown link fragments and hides link-internal paths from literal scanning", () => {
    const graph = buildSkillResourceGraph({
      "SKILL.md": "[references/hidden.md[a](references/faq.md#pricing)",
      "references/faq.md#pricing": "trap",
    });
    expect(graph.edges).toEqual([]);
    expect(graph.findings).toContainEqual(
      expect.objectContaining({ ruleId: "resource.missing", target: "references/faq.md" }),
    );
    expect(graph.findings.some((finding) => finding.target?.includes("hidden"))).toBe(false);
  });

  it("does not claim missing resources when the catalog only supplied SKILL.md", () => {
    const graph = buildSkillResourceGraph({ "SKILL.md": "Read references/guide.md." }, false);
    expect(graph.findings).toEqual([]);
    expect(graph.unresolved).toEqual([{ source: "SKILL.md", target: "references/guide.md" }]);
  });

  it("deduplicates equivalent references and recognizes normalized root escapes", () => {
    const graph = buildSkillResourceGraph({
      "SKILL.md":
        "Read `references/guide.md#section` and references/guide.md. Read `./` and `\\outside/path.md`.",
      "references/guide.md": "",
    });
    expect(graph.edges).toEqual([{ source: "SKILL.md", target: "references/guide.md" }]);
    expect(
      graph.findings.filter((finding) => finding.ruleId === "resource.escaping-link"),
    ).toHaveLength(2);
  });

  it.each([
    ["[x]([)y](z)", ["["]],
    ["a [x]([) references/notes.md b](x)", ["[", "references/notes.md"]],
    ["[x]([)y](z) [)y](z)", ["[", "z"]],
    ['[a](foo/bar.md "Title with ) paren")', ["foo/bar.md"]],
    ['![a](foo/bar.png "Logo")', ["foo/bar.png"]],
    ['[a](foo/bar.md "unterminated', []],
  ])("preserves source link scanning semantics", (content, expected) => {
    expect([...extractSkillReferences(content)].toSorted()).toEqual(expected.toSorted());
  });

  it("handles the upstream opener and closer dense adversarial regression shapes", () => {
    expect([...extractSkillReferences("[".repeat(65_536))]).toEqual([]);
    expect([...extractSkillReferences("[a](" + "x]([".repeat(65_536) + "b y)")]).toEqual([]);
  });
});
