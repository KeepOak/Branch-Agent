// Ports openai/codex@cc31e374fc15cd616fca19c07d55f9fa7e6d7e31:codex-rs/external-agent-migration/src/rewrite_tests.rs
// and the rewrite expectations of codex-rs/core-plugins/src/command_migration_tests.rs (atlas TOOLS-0139).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMigrationItem } from "branch/plugin-sdk/migration";
import { afterEach, describe, expect, it } from "vitest";
import { CLAUDE_REWRITE_PROFILE, rewriteTerms, type RewriteProfile } from "./rewrite.js";
import { applyGeneratedSkillItem } from "./skills.js";

const PROFILE: RewriteProfile = {
  docFileName: "SOURCE.md",
  termVariants: ["source agent"],
  caseSensitiveTermVariants: ["Source"],
};

describe("rewriteTerms", () => {
  it("rewrites_terms_only_at_word_boundaries", () => {
    expect(rewriteTerms("SOURCE.md Source source agent source_agent", PROFILE)).toBe(
      "AGENTS.md Branch Agent Branch Agent source_agent",
    );
  });

  it("rewrites every Claude product variant and CLAUDE.md case-insensitively", () => {
    expect(
      rewriteTerms(
        "Read claude.md, then ask Claude Code, claude-code, CLAUDE_CODE, ClaudeCode or Claude.",
        CLAUDE_REWRITE_PROFILE,
      ),
    ).toBe(
      "Read AGENTS.md, then ask Branch Agent, Branch Agent, Branch Agent, Branch Agent or Branch Agent.",
    );
  });

  it("leaves words that only contain a term untouched", () => {
    const input = "claudeish reclaude claude_codex myCLAUDE.md";
    expect(rewriteTerms(input, CLAUDE_REWRITE_PROFILE)).toBe(input);
  });

  it("keeps non-ASCII text and its offsets intact", () => {
    expect(rewriteTerms("İstanbul: ask Claude — then ünïcode", CLAUDE_REWRITE_PROFILE)).toBe(
      "İstanbul: ask Branch Agent — then ünïcode",
    );
  });
});

describe("applyGeneratedSkillItem rewrite", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("rewrites the description and body of an imported Claude command", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "migrate-claude-rewrite-"));
    dirs.push(root);
    const source = path.join(root, "review.md");
    await fs.writeFile(
      source,
      "Ask Claude Code to review the change.\n\nFollow CLAUDE.md before you start.\n",
    );
    const target = path.join(root, "skills", "claude-command-review");
    const item = createMigrationItem({
      id: "skill:claude-command-review",
      kind: "skill",
      action: "create",
      source,
      target,
      details: {
        sourceLabel: "project Claude command review.md",
        skillName: "claude-command-review",
      },
    });
    const result = await applyGeneratedSkillItem(item, path.join(root, "report"));
    expect(result.status).toBe("migrated");
    const skill = await fs.readFile(path.join(target, "SKILL.md"), "utf8");
    expect(skill).toContain('description: "Ask Branch Agent to review the change."');
    expect(skill).toContain("Follow AGENTS.md before you start.");
    expect(skill).toContain("<!-- Imported from Claude: project Claude command review.md -->");
    expect(skill).not.toMatch(/Claude Code|CLAUDE\.md/u);
  });
});
