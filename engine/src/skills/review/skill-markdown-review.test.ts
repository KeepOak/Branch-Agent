import { describe, expect, it } from "vitest";
import { reviewSkillMarkdown } from "./skill-markdown-review.js";

const valid =
  "---\nname: demo-skill\ndescription: Demo skill. Invoke when testing review.\nallowed-tools: []\n---\n# Demo\nFollow the steps and stop.\n";

describe("DeerFlow structural readiness port", () => {
  it("accepts minimal valid instructions and records the assessment scope", () => {
    const facts = reviewSkillMarkdown(valid);
    expect(facts.declaredName).toBe("demo-skill");
    expect(facts.findings).toEqual([]);
    expect(facts.completeness.notAssessed).toEqual([
      "package_enumeration",
      "resource_existence",
      "eval_manifests",
      "skillscan",
    ]);
    expect(facts.instructionDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it.each([
    ["---\nname: demo-skill\n---\n# Demo", "structure.missing-description"],
    ["---\nname: Upper_Name\ndescription: Demo\n---\n# Demo", "structure.invalid-name"],
    ["---\nname: demo\ndescription: Demo\n---\n", "structure.empty-body"],
    ["# no metadata", "structure.invalid-frontmatter"],
    ["---\nname: [broken\n---\n# Demo", "structure.invalid-frontmatter"],
    ["---\nname: 42\ndescription: Demo\n---\n# Demo", "structure.missing-name"],
  ])("reports the source rule for malformed instructions", (content, ruleId) => {
    expect(reviewSkillMarkdown(content).findings).toContainEqual(
      expect.objectContaining({ ruleId }),
    );
  });

  it("reports non-string frontmatter keys and typed secret declarations", () => {
    const content = valid.replace(
      "allowed-tools: []",
      '42: stray-value\nunexpected-field: value\nrequired-secrets:\n  - name: ERP_TOKEN\n    optional: "true"\nsecrets-autonomous: "true"',
    );
    const rules = reviewSkillMarkdown(content).findings.map((finding) => finding.ruleId);
    expect(rules).toEqual(
      expect.arrayContaining([
        "structure.unknown-frontmatter-field",
        "structure.invalid-required-secrets-optional",
        "structure.invalid-secrets-autonomous",
      ]),
    );
  });

  it.each(["[Read, 42]", "[Read, '']", "42", "Bash(unclosed", "Read)", "Bash('unclosed)"])(
    "reports malformed allowed-tools: %s",
    (tools) => {
      expect(
        reviewSkillMarkdown(valid.replace("allowed-tools: []", `allowed-tools: ${tools}`)).findings,
      ).toContainEqual(expect.objectContaining({ ruleId: "structure.invalid-allowed-tools" }));
    },
  );

  it("accepts BOM, CRLF, portable scoped tools, and never treats package coverage as complete", () => {
    const content =
      "\ufeff" + valid.replace("[]", "Bash(git status) Read").replaceAll("\n", "\r\n");
    expect(reviewSkillMarkdown(content).findings).toEqual([]);
    expect(reviewSkillMarkdown(content).completeness.packageEnumerated).toBe(false);
  });
});
