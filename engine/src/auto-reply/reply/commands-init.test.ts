// Adapted from letta-ai/letta-code@3687ea51f6d11eabc4ad7a7b163c649d023801ba src/cli/init-background-subagent.test.ts
// and src/skills/initializing-memory-guidance.test.ts.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareBundledSkillCommandForWorkspace } from "../../skills/discovery/chat-commands.js";
import type { SkillCommandSpec } from "../../skills/types.js";
import { listChatCommands } from "../commands-registry.js";
import { loadCommandHandlers } from "./commands-handlers.runtime.js";
import { buildInitMessage, gatherInitGitContext, handleInitCommand } from "./commands-init.js";
import { buildCommandTestParams } from "./commands.test-harness.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-init-command-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const initSkill: SkillCommandSpec = {
  name: "initializing_memory",
  skillName: "initializing-memory",
  description: "Guide for initializing or reorganizing agent memory.",
  skillFile: "/bundled/skills/initializing-memory/SKILL.md",
  skillSource: "bundled",
  modelVisible: true,
};

describe("init command helpers", () => {
  it("buildInitMessage includes memoryDir when provided", () => {
    const msg = buildInitMessage({ gitContext: "## Git\nsome info", memoryDir: "/tmp/.memory" });
    expect(msg).toContain("Your memory files live in your workspace");
    expect(msg).toContain("/tmp/.memory");
    expect(msg).toContain("initializing-memory");
  });

  it("buildInitMessage works without memoryDir", () => {
    const msg = buildInitMessage({ gitContext: "## Git\nsome info" });
    expect(msg).not.toContain("Memory files");
    expect(msg).toContain("initializing-memory");
  });

  it("buildInitMessage carries the git identity and an optional request", () => {
    const msg = buildInitMessage({
      gitContext: "- branch: main",
      gitIdentity: "Test User <test@example.com>",
      request: "focus on the CLI",
    });
    expect(msg).toContain("git_user: Test User <test@example.com>");
    expect(msg).toContain("focus on the CLI");
  });

  it("gathers git context from a repository and reports non-repositories", async () => {
    const plain = makeTempDir();
    await expect(gatherInitGitContext(plain)).resolves.toEqual({
      context: "(not a git repository)",
      identity: "",
    });

    const repo = makeTempDir();
    const run = (...args: string[]) => execFileSync("git", ["-C", repo, ...args]);
    run("init", "-q", "-b", "main");
    run("config", "user.name", "Test User");
    run("config", "user.email", "test@example.com");
    fs.writeFileSync(path.join(repo, "README.md"), "# demo\n");
    run("add", "README.md");
    run("commit", "-q", "-m", "initial commit");

    const git = await gatherInitGitContext(repo);
    expect(git.identity).toBe("Test User <test@example.com>");
    expect(git.context).toContain("- branch: main");
    expect(git.context).toContain("- status: (clean)");
    expect(git.context).toContain("initial commit");
  });
});

describe("/init command", () => {
  it("selects the initializing-memory skill and turns /init into an agent turn", async () => {
    const workspaceDir = makeTempDir();
    const params = buildCommandTestParams("/init", { commands: { text: true } }, undefined, {
      workspaceDir,
    });
    params.skillCommands = [initSkill];

    const result = await handleInitCommand(params, true);

    expect(result).toEqual({
      shouldContinue: true,
      explicitSkillSelections: [
        { name: "initializing_memory", path: "/bundled/skills/initializing-memory/SKILL.md" },
      ],
    });
    const prompt = params.ctx.BodyForAgent ?? "";
    expect(prompt).toContain("The user has requested memory initialization via /init.");
    expect(prompt).toContain(workspaceDir);
    expect(prompt).toContain("(not a git repository)");
  });

  it("explains when the skill is unavailable", async () => {
    const params = buildCommandTestParams("/init", { commands: { text: true } });
    params.skillCommands = [];
    await expect(handleInitCommand(params, true)).resolves.toMatchObject({
      shouldContinue: false,
      reply: { text: expect.stringContaining("initializing-memory skill is unavailable") },
    });
  });

  it("is registered as a built-in command and dispatched by the command handlers", () => {
    const init = listChatCommands().find((command) => command.key === "init");
    expect(init?.textAliases).toEqual(["/init"]);
    expect(loadCommandHandlers()).toContain(handleInitCommand);
  });

  it("ships the initializing-memory skill as a bundled skill", async () => {
    const skill = await prepareBundledSkillCommandForWorkspace({
      workspaceDir: makeTempDir(),
      cfg: {},
      skillName: "initializing-memory",
    });
    expect(skill?.skillSource).toBe("bundled");
    expect(skill?.skillName).toBe("initializing-memory");
    const body = fs.readFileSync(skill?.skillFile ?? "", "utf8");
    expect(body).toContain("## Initialization Flow");
    expect(body).toContain("MEMORY.md");
  });
});
