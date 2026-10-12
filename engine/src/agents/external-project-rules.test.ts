// Adapted from Cline 0809928ab28783c0d2b41c1e56edaf0951dadcab rule tests.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseExternalRule,
  externalRuleMatches,
  extractExternalRulePaths,
} from "./external-project-rules.conditions.js";
import {
  createExternalRuleFiles,
  discoverExternalRuleLayouts,
  externalRulePath,
} from "./external-project-rules.files.js";
import {
  inspectExternalProjectRules,
  prepareExternalProjectRulesPrompt,
  toggleExternalProjectRule,
} from "./external-project-rules.js";
import { registerAgentWorkspaceAccess } from "./workspace-access.js";

const directory = path.join(
  os.tmpdir(),
  "Codex-session-files",
  "branch-feature-third-20261003",
  "memory",
);
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.relative(directory, root).startsWith("rules-"))
      throw new Error("Invalid fixture cleanup root");
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function fixture(files: Record<string, string>) {
  await fs.mkdir(directory, { recursive: true });
  const root = await fs.mkdtemp(path.join(directory, "rules-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  const agentDir = path.join(root, "agent");
  await fs.mkdir(workspace);
  await fs.mkdir(agentDir);
  for (const [relative, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(workspace, relative)), { recursive: true });
    await fs.writeFile(path.join(workspace, relative), content);
  }
  return { workspace, agentDir, root };
}

describe("donor frontmatter and paths", () => {
  it.each([
    ["Just text", {}, "Just text"],
    ["---\npaths:\n  - src/**\n---\nHello", { paths: ["src/**"] }, "Hello"],
    ["---\npaths: [invalid\n---\nBody", {}, "---\npaths: [invalid\n---\nBody"],
    [
      "---\nfoo: !!js/function 'function(){ return 1 }'\n---\nBody",
      {},
      "---\nfoo: !!js/function 'function(){ return 1 }'\n---\nBody",
    ],
    [
      "---\nfoo: !!python/object:os.system 'echo pwned'\n---\nBody",
      {},
      "---\nfoo: !!python/object:os.system 'echo pwned'\n---\nBody",
    ],
    [
      "---\ncount: 42\nenabled: true\ntags: [a, b]\n---\nContent",
      { count: 42, enabled: true, tags: ["a", "b"] },
      "Content",
    ],
    [
      "\uFEFF---\nname: my-skill\ndescription: A test skill\n---\n# my-skill",
      { name: "my-skill", description: "A test skill" },
      "# my-skill",
    ],
  ])("parses source case %s", (input, data, body) => {
    const result = parseExternalRule(input as string);
    expect(result.data).toEqual(data);
    expect(result.body.trim()).toBe(body);
  });

  it.each([
    [{}, [], true],
    [{ paths: [] }, ["src/index.ts"], false],
    [{ paths: ["src/**"] }, [], false],
    [{ paths: ["src/**", "apps/**"] }, ["src/index.ts"], true],
    [{ paths: "src/**" }, [], true],
  ])("evaluates source conditional %j", (data, candidates, passed) => {
    expect(externalRuleMatches(data, candidates as string[]).passed).toBe(passed);
  });

  it.each([
    [
      "edit apps/web/src/App.tsx and packages/foo/src",
      ["apps/web/src/App.tsx", "packages/foo/src"],
    ],
    ["Does foo.md exist? If not, create foo.md", ["foo.md"]],
    ["Please create foo and then update bar", []],
    ["see https://example.com/a/b and edit src/index.ts", ["src/index.ts"]],
    [
      "Please update src/index.ts\n```ts\nconst p = 'apps/web/src/App.tsx'\n```\nThanks",
      ["src/index.ts"],
    ],
    [
      "```\nSee https://example.com/a/b and src/index.ts\n```\nBut edit docs/readme.md",
      ["docs/readme.md"],
    ],
    [
      "Error: boom\n    at foo (src/index.ts:12:3)\n    at bar (apps/web/src/App.tsx:5:1)",
      ["src/index.ts", "apps/web/src/App.tsx"],
    ],
  ])("extracts source request paths %s", (text, paths) => {
    expect(extractExternalRulePaths(text as string)).toEqual(paths);
  });

  it("keeps CRLF, aliases, unknown keys and source dot matching", () => {
    expect(parseExternalRule("---\r\npaths: &p [src/**]\r\nalias: *p\r\n---\r\nBody").data).toEqual(
      { paths: ["src/**"], alias: ["src/**"] },
    );
    expect(externalRuleMatches({ unknown: false }, []).passed).toBe(true);
    expect(externalRuleMatches({ paths: ["   "] }, ["src/a.ts"]).passed).toBe(false);
    expect(externalRuleMatches({ paths: ["src/**"] }, ["src\\.hidden.ts"]).matched).toEqual([
      "src/**",
    ]);
  });
});

describe("actual editor compatibility files", () => {
  it("merges both Cursor layouts, discovers Windsurf and preserves separate false values", async () => {
    const options = await fixture({
      ".cursorrules": "legacy",
      ".cursor/rules/a.mdc": "modern",
      ".windsurfrules": "wind",
    });
    expect((await inspectExternalProjectRules(options)).state).toEqual({
      cursor: { ".cursor/rules/a.mdc": true, ".cursorrules": true },
      windsurf: { ".windsurfrules": true },
    });
    await toggleExternalProjectRule(options, "cursor", ".cursorrules", false);
    await toggleExternalProjectRule(options, "windsurf", ".windsurfrules", false);
    expect(await prepareExternalProjectRulesPrompt(options)).toContain("modern");
    expect(await prepareExternalProjectRulesPrompt(options)).not.toContain("legacy");
    expect((await inspectExternalProjectRules(options)).state.windsurf[".windsurfrules"]).toBe(
      false,
    );
  });

  it("finds directory-only rules and includes exact extensions, nested files and source metadata exclusions", async () => {
    const options = await fixture({
      ".cursor/rules/nested/@scope.mdc": "included",
      ".cursor/rules/skip.md": "excluded",
      ".cursor/rules/skip.MDC": "excluded",
      ".cursor/rules/desktop.ini": "excluded",
    });
    const found = await discoverExternalRuleLayouts(createExternalRuleFiles(options));
    expect(found[0]!.files).toEqual([".cursor/rules/nested/@scope.mdc"]);
    expect(found[1]!.files).toEqual([]);
    expect(await prepareExternalProjectRulesPrompt(options)).toContain("included");
  });

  it("prunes confirmed deleted files and enables their recreation", async () => {
    const options = await fixture({ ".cursor/rules/a.mdc": "A", ".cursorrules": "B" });
    await toggleExternalProjectRule(options, "cursor", ".cursor/rules/a.mdc", false);
    await fs.unlink(path.join(options.workspace, ".cursor/rules/a.mdc"));
    await prepareExternalProjectRulesPrompt(options);
    expect((await inspectExternalProjectRules(options)).state.cursor).toEqual({
      ".cursorrules": true,
    });
    await fs.writeFile(path.join(options.workspace, ".cursor/rules/a.mdc"), "recreated");
    expect(await prepareExternalProjectRulesPrompt(options)).toContain("recreated");
  });

  it("loads legacy directories without inventing an extension restriction", async () => {
    const options = await fixture({
      ".cursorrules/any.txt": "any extension",
      ".windsurfrules/nested/rule.md": "windsurf directory",
    });
    const prompt = await prepareExternalProjectRulesPrompt(options);
    expect(prompt).toContain("any extension");
    expect(prompt).toContain("windsurf directory");
  });

  it("loads scoped/universal contents using actual request candidates", async () => {
    const options = await fixture({
      ".cursor/rules/universal.mdc": "Always on",
      ".cursor/rules/scoped.mdc": "---\npaths: [src/**]\n---\nOnly for src",
    });
    const src = await prepareExternalProjectRulesPrompt({
      ...options,
      prompt: "Edit src/index.ts",
    });
    expect(src).toContain("Always on");
    expect(src).toContain("Only for src");
    expect(src).not.toContain("paths:");
    expect(
      await prepareExternalProjectRulesPrompt({ ...options, prompt: "Edit docs/readme.md" }),
    ).not.toContain("Only for src");
  });

  it("preserves invalid YAML raw contents", async () => {
    const options = await fixture({ ".cursorrules": "---\npaths: *\n---\nInvalid YAML included" });
    expect(await prepareExternalProjectRulesPrompt(options)).toContain(
      "---\npaths: *\n---\nInvalid YAML included",
    );
  });

  it("does not activate paths empty", async () => {
    const options = await fixture({ ".cursorrules": "---\npaths: []\n---\nNever activate" });
    expect(
      await prepareExternalProjectRulesPrompt({ ...options, prompt: "src/index.ts" }),
    ).toBeUndefined();
  });

  it("preserves supplied file order in content and matches multiple source globs", async () => {
    const options = await fixture({
      ".cursor/rules/a.mdc": "---\npaths: [src/**]\n---\nA_RULE",
      ".cursor/rules/b.mdc": "---\npaths: [src/**]\n---\nB_RULE",
    });
    const prompt = await prepareExternalProjectRulesPrompt({ ...options, prompt: "src/index.ts" });
    expect(prompt!.indexOf("A_RULE")).toBeLessThan(prompt!.indexOf("B_RULE"));
  });

  it("preserves literal @ and distinguishes Windows traversal from POSIX literal backslash", () => {
    expect(externalRulePath(".cursor/rules/@scope.mdc")).toBe(".cursor/rules/@scope.mdc");
    expect(() => externalRulePath("..\\outside", false)).toThrow();
    expect(externalRulePath(".cursor/rules/literal\\name.mdc", true)).toContain("\\");
  });

  it("rejects an actual external junction without importing its bytes", async () => {
    const options = await fixture({});
    const outside = path.join(options.root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "outside.mdc"), "OUTSIDE_RULE_BYTES");
    await fs.mkdir(path.join(options.workspace, ".cursor"));
    await fs.symlink(
      outside,
      path.join(options.workspace, ".cursor/rules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const prompt = await prepareExternalProjectRulesPrompt(options);
    expect(prompt).toContain("unavailable");
    expect(prompt).not.toContain("OUTSIDE_RULE_BYTES");
    await fs.unlink(path.join(options.workspace, ".cursor/rules"));
  });

  it("reads a real rule beyond the native root reader's default byte budget without a new source cap", async () => {
    const body = `${"x".repeat(17 * 1024 * 1024)}UNCAPPED_RULE_END`;
    const options = await fixture({ ".cursorrules": body });
    const prompt = await prepareExternalProjectRulesPrompt(options);
    expect(prompt).toContain("UNCAPPED_RULE_END");
    expect(prompt).not.toContain("unavailable");
  });

  it("requires a successful pinned bridge read to belong to the selected workspace mount", async () => {
    const options = await fixture({});
    const release = registerAgentWorkspaceAccess(options.workspace, {
      bridge: {
        stat: async ({ filePath }) =>
          filePath === "./.cursorrules" ? { type: "file", size: 1, mtimeMs: 1 } : null,
        readFileWithSource: async () => ({
          data: Buffer.from("OTHER_MOUNT_BYTES"),
          canonicalPath: "/other-mount/.cursorrules",
        }),
        readFile: async () => {
          throw new Error("must not re-read");
        },
        writeFile: async () => {
          throw new Error("must not write");
        },
      },
    });
    try {
      const prompt = await prepareExternalProjectRulesPrompt(options);
      expect(prompt).toContain("outside the selected workspace mount");
      expect(prompt).not.toContain("OTHER_MOUNT_BYTES");
    } finally {
      release();
    }
  });

  it("uses the actual registered bridge, retains false on discovery failure and never host-falls-back", async () => {
    const options = await fixture({ ".cursorrules": "HOST_FALLBACK" });
    await toggleExternalProjectRule(options, "cursor", ".cursorrules", false);
    const release = registerAgentWorkspaceAccess(options.workspace, {
      bridge: {
        stat: async () => {
          throw new Error("bridge unavailable");
        },
        readFile: async () => {
          throw new Error("must not read");
        },
        writeFile: async () => {
          throw new Error("must not write");
        },
      },
    });
    try {
      const prompt = await prepareExternalProjectRulesPrompt(options);
      expect(prompt).toContain("bridge unavailable");
      expect(prompt).not.toContain("HOST_FALLBACK");
      expect((await inspectExternalProjectRules(options)).state.cursor[".cursorrules"]).toBe(false);
    } finally {
      release();
    }
    expect(await prepareExternalProjectRulesPrompt(options)).toContain("Workspace access");
  });
});
