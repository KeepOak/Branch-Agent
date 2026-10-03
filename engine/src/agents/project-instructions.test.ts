import { describe, expect, it } from "vitest";
import {
  loadTouchedProjectRules,
  parseProjectRule,
  projectRuleApplies,
} from "./project-instructions.js";

describe("Continue project rule matching", () => {
  it("keeps nested rules scoped to the complete ancestor path", () => {
    const rule = { sourceFile: "src/auth/rules.md", rule: "Auth conventions" };
    expect(projectRuleApplies(rule, "src/auth/nested/helper.ts")).toBe(true);
    expect(projectRuleApplies(rule, "src/authentication/helper.ts")).toBe(false);
    expect(projectRuleApplies(rule, "other/auth/helper.ts")).toBe(false);
    expect(projectRuleApplies(rule, "src/auth", undefined, true)).toBe(true);
    expect(projectRuleApplies(rule, "src/auth")).toBe(false);
  });

  it("matches glob arrays, braces, and exclusions as upstream does", () => {
    const rule = {
      sourceFile: "src/rules.md",
      rule: "Typed files",
      globs: ["src/**/*.{ts,tsx}", "!src/**/*.test.ts"],
    };
    expect(projectRuleApplies(rule, "src/ui/Button.tsx")).toBe(true);
    expect(projectRuleApplies(rule, "src/ui/Button.test.ts")).toBe(false);
    expect(projectRuleApplies(rule, "src/ui/Button.js")).toBe(false);
    expect(projectRuleApplies({ ...rule, globs: "!**/*.test.ts" }, "src/main.ts")).toBe(true);
  });

  it("combines content regex with matching globs and handles invalid expressions", () => {
    const rule = {
      sourceFile: "src/rules.md",
      rule: "Use API conventions",
      globs: "**/*.ts",
      regex: ["fetch\\(", "axios"],
    };
    expect(projectRuleApplies(rule, "src/main.ts", "fetch(url)")).toBe(true);
    expect(projectRuleApplies(rule, "src/main.js", "axios.get(url)")).toBe(false);
    expect(projectRuleApplies(rule, "src/main.ts", "console.log(1)")).toBe(false);
    expect(projectRuleApplies(rule, "src/main.ts")).toBe(false);
    expect(projectRuleApplies({ ...rule, regex: "[" }, "src/main.ts", "fetch(url)")).toBe(false);
  });

  it("preserves implicit global, always-on, and agent-requested semantics", () => {
    const rule = { sourceFile: ".continue/rules/style.md", rule: "Style" };
    expect(projectRuleApplies(rule, "main.ts")).toBe(true);
    expect(projectRuleApplies({ ...rule, alwaysApply: false }, "main.ts")).toBe(false);
    expect(projectRuleApplies({ ...rule, alwaysApply: false, globs: "*.ts" }, "main.ts")).toBe(
      true,
    );
    expect(projectRuleApplies({ ...rule, alwaysApply: true, globs: "*.py" }, "main.ts")).toBe(true);
  });

  it("parses upstream frontmatter while excluding invokable prompts and empty rules", () => {
    expect(
      parseProjectRule(
        "src/rules.md",
        "---\nglobs: '**/*.ts'\nregex: TODO\nalwaysApply: false\n---\nUse types",
      ),
    ).toEqual({
      sourceFile: "src/rules.md",
      rule: "Use types",
      globs: "**/*.ts",
      regex: "TODO",
      alwaysApply: false,
    });
    expect(
      parseProjectRule("rules.md", "---\ninvokable: true\n---\nManual prompt"),
    ).toBeUndefined();
    expect(parseProjectRule("rules.md", "  ")).toBeUndefined();
  });
});

describe("Continue ancestor discovery", () => {
  const data = new Map([
    [".continuerules", "Legacy workspace guidance"],
    [".continue/rules/global.md", "Global guidance"],
    ["rules.md", "Root guidance"],
    ["src/rules.md", "Source guidance"],
    ["src/auth/rules.md", "Auth guidance"],
    ["src/other/rules.md", "Other guidance"],
  ]);
  const files = {
    read: async (filePath: string) => data.get(filePath),
    list: async () => [".continue/rules/global.md"],
  };

  it("loads the root and every touched ancestor without enumerating siblings", async () => {
    const rules = await loadTouchedProjectRules({ filePath: "src/auth/client.ts", files });
    expect(rules.map((rule) => rule.rule)).toEqual([
      "Legacy workspace guidance",
      "Global guidance",
      "Root guidance",
      "Source guidance",
      "Auth guidance",
    ]);
  });

  it("includes the listed directory itself", async () => {
    const rules = await loadTouchedProjectRules({ filePath: "src/auth", directory: true, files });
    expect(rules.at(-1)?.rule).toBe("Auth guidance");
  });

  it("keeps valid rules when an individual rule cannot be parsed", async () => {
    const warnings: string[] = [];
    const rules = await loadTouchedProjectRules({
      filePath: "src/auth/client.ts",
      files: {
        ...files,
        read: async (filePath) =>
          filePath === "src/rules.md" ? "---\nglobs: [\n---\nBroken" : data.get(filePath),
      },
      warn: (message) => warnings.push(message),
    });
    expect(rules.at(-1)?.rule).toBe("Auth guidance");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("src/rules.md");
  });
});
