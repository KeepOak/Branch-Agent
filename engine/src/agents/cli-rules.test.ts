// Adapted from continuedev/continue@5522c6f44ca0ac3528b37244818fbfa39b5af470 extensions/cli/src/integration/rule-duplication.test.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isStringRule,
  mergeCliRulesIntoExtraSystemPrompt,
  processRule,
  resolveCliRules,
} from "./cli-rules.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-cli-rules-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("isStringRule", () => {
  it("treats text with spaces or newlines as a string rule", () => {
    expect(isStringRule("Answer in Spanish")).toBe(true);
    expect(isStringRule("line one\nline two")).toBe(true);
    expect(isStringRule("direct-rule")).toBe(true);
  });

  it("treats local paths and hub slugs as non-string rules", () => {
    expect(isStringRule("./RULES.md")).toBe(false);
    expect(isStringRule("/abs/RULES.md")).toBe(false);
    expect(isStringRule("~/RULES.md")).toBe(false);
    expect(isStringRule("file:/tmp/RULES.md")).toBe(false);
    expect(isStringRule("rules\\RULES.md")).toBe(false);
    expect(isStringRule("nate/spanish")).toBe(false);
  });
});

describe("processRule", () => {
  it("reads a rule file when the spec looks like a path", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "rules.md"), "Use tabs.\n", "utf8");
    expect(processRule("./rules.md", dir)).toBe("Use tabs.\n");
    expect(processRule(path.join(dir, "rules.md"))).toBe("Use tabs.\n");
  });

  it("fails loudly for a missing rule file", () => {
    const dir = makeTempDir();
    expect(() => processRule("./missing.md", dir)).toThrow(
      'Failed to read rule file "./missing.md": Rule file not found: ./missing.md',
    );
  });

  it("returns literal content for text and multiline specs", () => {
    expect(processRule("Always cite sources")).toBe("Always cite sources");
    expect(processRule("first.md\nsecond")).toBe("first.md\nsecond");
  });
});

describe("rule duplication", () => {
  it("should not duplicate rules when using --rule flag", () => {
    expect(resolveCliRules(["direct-rule", "direct-rule"])).toEqual(["direct-rule"]);
  });

  it("should merge command-line rules with existing extra instructions", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "rules.md"), "From file.\n", "utf8");
    expect(
      mergeCliRulesIntoExtraSystemPrompt(
        "Existing prompt.",
        ["./rules.md", "direct-rule", "./rules.md"],
        dir,
      ),
    ).toBe("Existing prompt.\n\nFrom file.\n\ndirect-rule");
  });

  it("drops a file rule whose content repeats a literal rule", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "same.md"), "direct-rule\n", "utf8");
    expect(resolveCliRules(["direct-rule", "./same.md"], dir)).toEqual(["direct-rule"]);
  });

  it("rejects hub package identifiers because hub loading is not available", () => {
    expect(() => resolveCliRules(["nate/spanish"])).toThrow(
      'Hub package loading has been removed. Cannot load "nate/spanish" from hub.',
    );
  });

  it("keeps the existing prompt when no rules are given", () => {
    expect(mergeCliRulesIntoExtraSystemPrompt("Existing.", [])).toBe("Existing.");
    expect(mergeCliRulesIntoExtraSystemPrompt(undefined, undefined)).toBeUndefined();
  });
});
