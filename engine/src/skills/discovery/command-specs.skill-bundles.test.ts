import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripRuntimeOnlySessionSkillsFields } from "../../config/sessions/store-entry-shape.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { cleanupSessionStateForTest } from "../../test-utils/session-state-cleanup.js";
import { resolveSkillCommandInvocation } from "./chat-command-invocation.js";
import {
  listSkillCommandsForWorkspace,
  prepareSkillBundleInvocationForWorkspace,
  prepareSkillCommandsForWorkspace,
} from "./chat-commands.js";

let root: string;
let workspace: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-bundle-discovery-"));
  workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  fs.mkdirSync(path.join(root, "skill-bundles"));
  vi.stubEnv("BRANCH_STATE_DIR", root);
  vi.stubEnv("BRANCH_HOME", root);
});
afterEach(async () => {
  await cleanupSessionStateForTest({ stateDir: root, rootPath: root });
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  vi.unstubAllEnvs();
});
function skill(name: string, extra = "") {
  const directory = path.join(workspace, "skills", name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: skill ${name}\n${extra}---\n\nWHOLE ${name}`,
  );
}
function alias(name: string, skills = ["alpha"]) {
  fs.writeFileSync(
    path.join(root, "skill-bundles", "combo.yaml"),
    `name: ${name}\nskills: ${JSON.stringify(skills)}\ninstruction: Literal $ARGUMENTS\n`,
  );
}
function context(cfg: BranchConfig = {}) {
  return { workspaceDir: workspace, cfg, agentId: "main" };
}

describe("actual native bundle command discovery and fresh authorization", () => {
  it("gives bundle precedence over the ordinary exact underscore spelling", async () => {
    skill("my-bundle");
    skill("alpha");
    alias("my-bundle");
    const commands = await prepareSkillCommandsForWorkspace(context());
    expect(
      resolveSkillCommandInvocation({
        commandBodyNormalized: "/my_bundle request",
        skillCommands: commands,
      })?.command.skillBundle,
    ).toBeDefined();
  });
  it("enforces native platform and required-host eligibility with an allowed positive control", async () => {
    skill("alpha");
    skill("wrong-os", 'metadata: {"branch":{"os":["not-a-platform"]}}\n');
    skill(
      "missing-host",
      'metadata: {"branch":{"requires":{"bins":["branch-fixture-binary-that-does-not-exist"]}}}\n',
    );
    skill("right-os", `metadata: {"branch":{"os":["${process.platform}"]}}\n`);
    alias("combo", ["alpha", "wrong-os", "missing-host", "right-os"]);
    const command = (await prepareSkillCommandsForWorkspace(context())).find(
      (entry) => entry.skillBundle,
    )!;
    const result = await prepareSkillBundleInvocationForWorkspace({
      ...context(),
      bundle: command.skillBundle!,
    });
    expect(result).toMatchObject({
      loaded: ["alpha", "right-os"],
      disabled: ["wrong-os", "missing-host"],
    });
    expect(result?.message).not.toContain("WHOLE wrong-os");
    expect(result?.message).not.toContain("WHOLE missing-host");
  });
  it("discovers sync and async metadata without reading member instructions at invocation time", async () => {
    skill("alpha");
    alias("combo");
    const sync = listSkillCommandsForWorkspace(context()).find((command) => command.skillBundle);
    const async = (await prepareSkillCommandsForWorkspace(context())).find(
      (command) => command.skillBundle,
    );
    expect(sync).toEqual(async);
    expect(sync?.skillFile).toBeUndefined();
    expect(JSON.stringify(sync)).not.toContain("WHOLE alpha");
  });
  it("preserves complete source slugs, underscore lookup and bundle precedence", async () => {
    skill("combo");
    skill("alpha");
    alias("combo");
    let commands = await prepareSkillCommandsForWorkspace(context());
    expect(
      resolveSkillCommandInvocation({
        commandBodyNormalized: "/combo request",
        skillCommands: commands,
      })?.command.skillBundle,
    ).toBeDefined();
    expect(
      resolveSkillCommandInvocation({
        commandBodyNormalized: "/skill combo request",
        skillCommands: commands,
      })?.command.skillBundle,
    ).toBeDefined();
    const name = `小说-${"long-bundle-".repeat(7)}name`;
    alias(name);
    fs.utimesSync(
      path.join(root, "skill-bundles"),
      new Date(Date.now() + 100_000),
      new Date(Date.now() + 100_000),
    );
    commands = await prepareSkillCommandsForWorkspace(context());
    expect(
      resolveSkillCommandInvocation({
        commandBodyNormalized: `/${name.replaceAll("-", "_")} request`,
        skillCommands: commands,
      })?.command.name,
    ).toBe(name);
  });
  it("retains builtin namespace and independent metadata when all members are missing", async () => {
    alias("help", ["ghost"]);
    expect(
      (await prepareSkillCommandsForWorkspace(context())).some((command) => command.skillBundle),
    ).toBe(false);
    alias("combo", ["ghost"]);
    fs.utimesSync(
      path.join(root, "skill-bundles"),
      new Date(Date.now() + 200_000),
      new Date(Date.now() + 200_000),
    );
    const command = (await prepareSkillCommandsForWorkspace(context())).find(
      (entry) => entry.skillBundle,
    )!;
    expect(command).toBeDefined();
    expect(
      await prepareSkillBundleInvocationForWorkspace({
        ...context(),
        bundle: command.skillBundle!,
      }),
    ).toBeUndefined();
  });
  it("recomputes config, agent and session eligibility instead of trusting stale menu members", async () => {
    skill("alpha");
    skill("beta");
    alias("combo", ["alpha", "beta"]);
    const command = (await prepareSkillCommandsForWorkspace(context())).find(
      (entry) => entry.skillBundle,
    )!;
    const cfg: BranchConfig = { skills: { entries: { beta: { enabled: false } } } };
    const result = await prepareSkillBundleInvocationForWorkspace({
      ...context(cfg),
      bundle: command.skillBundle!,
    });
    expect(result).toMatchObject({ loaded: ["alpha"], disabled: ["beta"] });
    const session = await prepareSkillBundleInvocationForWorkspace({
      ...context(),
      bundle: command.skillBundle!,
      sessionEntry: {
        toolOverrides: { skills: { beta: false } },
        skillsSnapshot: { prompt: "", skills: [], skillOverrides: { beta: true } },
      },
    });
    expect(session?.loaded).toEqual(["alpha"]);
    const agent = await prepareSkillBundleInvocationForWorkspace({
      ...context(),
      bundle: command.skillBundle!,
      skillFilter: ["beta"],
    });
    expect(agent?.loaded).toEqual(["beta"]);
    const allowed = await prepareSkillBundleInvocationForWorkspace({
      ...context(),
      bundle: command.skillBundle!,
    });
    expect(allowed?.loaded).toEqual(["alpha", "beta"]);
  });
  it("retains the real admitted overlay through the native persisted snapshot projection", () => {
    const persisted = stripRuntimeOnlySessionSkillsFields({
      sessionId: "snapshot-session",
      updatedAt: 1,
      skillsSnapshot: {
        prompt: "",
        skills: [],
        resolvedSkills: [],
        skillOverrides: { beta: false },
      },
    });
    expect(persisted.skillsSnapshot?.skillOverrides).toEqual({ beta: false });
    expect(persisted.skillsSnapshot?.resolvedSkills).toBeUndefined();
  });
  it("uses fresh alias membership and member bytes without caching bodies", async () => {
    skill("alpha");
    skill("beta");
    alias("combo");
    const command = (await prepareSkillCommandsForWorkspace(context())).find(
      (entry) => entry.skillBundle,
    )!;
    fs.writeFileSync(path.join(workspace, "skills", "alpha", "SKILL.md"), "FRESH WHOLE alpha");
    expect(
      (
        await prepareSkillBundleInvocationForWorkspace({
          ...context(),
          bundle: command.skillBundle!,
        })
      )?.message,
    ).toContain("FRESH WHOLE alpha");
    alias("combo", ["beta"]);
    fs.utimesSync(
      path.join(root, "skill-bundles"),
      new Date(Date.now() + 300_000),
      new Date(Date.now() + 300_000),
    );
    expect(
      (
        await prepareSkillBundleInvocationForWorkspace({
          ...context(),
          bundle: command.skillBundle!,
        })
      )?.loaded,
    ).toEqual(["beta"]);
  });
});
