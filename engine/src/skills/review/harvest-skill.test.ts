import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { reviewSkillMarkdown } from "./skill-markdown-review.js";

const skillPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../skills/harvest/SKILL.md",
);

describe("harvest skill", () => {
  const content = readFileSync(skillPath, "utf8");

  it("passes structural skill review", () => {
    const review = reviewSkillMarkdown(content);
    expect(review.declaredName).toBe("harvest");
    expect(review.findings.filter((finding) => finding.severity !== "warning")).toEqual([]);
    expect(content.startsWith("---\n")).toBe(true);
  });

  it("keeps the pin, test, ledger, notice, and note steps", () => {
    expect(content).toContain("40-character commit");
    expect(content).toContain("*.harvest.test.ts");
    expect(content).toContain("failed before a production change and passed after it");
    expect(content).toContain("docs/upstream/COPIED.csv");
    expect(content).toContain("branch_path,atlas_id,project,commit,upstream_path,date");
    expect(content).toContain("NOTICE");
    expect(content).toContain("third_party/<short-name>/LICENSE");
    expect(content).toContain("docs/harvest/<atlas-id>.md");
    expect(content).toContain("<upstream-checkout-dir>/<owner>-<repo>");
    expect(content).not.toContain("/tmp/upstream");
  });

  it("keeps the permissive-license, closed-app, and ask-first rules", () => {
    expect(content).toContain(
      "Code may only be copied from permissively licensed sources (MIT, Apache-2.0, BSD, ISC, and similar).",
    );
    expect(content).toContain(
      "A closed app (for example an Electron app) may only be studied for behavior and design, never copied.",
    );
    expect(content).toContain(
      "Any tool that runs commands, drives apps or overwrites files must ask first.",
    );
  });
});
