import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { BranchConfig } from "../config/types.branch.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { applyGroveAddPlan } from "./add.js";
import { buildGroveAddPlan } from "./lifecycle.js";
import { parseGroveManifest } from "./schema.js";
import type { GroveSourceIdentity } from "./types.js";
import { buildGroveUpdatePlan } from "./update-plan.js";
import { applyGroveWorkspaceUpdate } from "./workspace-update.js";
import { readGroveWorkspaceFiles } from "./workspace.js";

afterEach(() => closeBranchStateDatabaseForTest());
const tempDirs = useAutoCleanupTempDirTracker(afterEach);

describe("applyGroveWorkspaceUpdate", () => {
  it("applies add/change/remove actions and can roll them back with provenance", async () => {
    const root = tempDirs.make("branch-grove-workspace-update-");
    const currentRoot = join(root, "current");
    const targetRoot = join(root, "target");
    await mkdir(currentRoot);
    await mkdir(targetRoot);
    await writeFile(join(currentRoot, "SOUL.md"), "current soul\n", "utf8");
    await writeFile(join(currentRoot, "OLD.md"), "old\n", "utf8");
    const targetSoul = Buffer.from("target soul\n");
    await writeFile(
      join(targetRoot, "GROVE.md"),
      Buffer.concat([
        Buffer.from("---\nschemaVersion: 1\nagent: { id: worker }\n---\n"),
        targetSoul,
      ]),
    );
    await writeFile(join(targetRoot, "NEW.md"), "new\n", "utf8");

    const currentParsed = parseGroveManifest({
      schemaVersion: 1,
      agent: { id: "worker" },
      workspace: {
        bootstrapFiles: { "SOUL.md": { source: "SOUL.md" } },
        files: [{ source: "OLD.md", path: "OLD.md" }],
      },
    });
    const targetParsed = parseGroveManifest({
      schemaVersion: 1,
      agent: { id: "worker" },
      workspace: {
        files: [{ source: "NEW.md", path: "NEW.md" }],
      },
    });
    if (!currentParsed.ok || !targetParsed.ok) {
      throw new Error("fixture manifest invalid");
    }
    const currentSource: GroveSourceIdentity = {
      kind: "package",
      name: "@acme/worker",
      version: "1.0.0",
      packageRoot: currentRoot,
      manifestPath: join(currentRoot, "branch.grove.json"),
      integrityKind: "artifact",
      integrity: "sha256:current",
      byteLength: 1,
    };
    const targetSource: GroveSourceIdentity = {
      ...currentSource,
      version: "2.0.0",
      packageRoot: targetRoot,
      manifestPath: join(targetRoot, "GROVE.md"),
      integrity: "sha256:target",
    };
    const workspace = join(root, "workspace");
    const env = { BRANCH_STATE_DIR: join(root, "state") };
    const currentAddPlan = await buildGroveAddPlan({
      manifest: currentParsed.manifest,
      source: currentSource,
      context: { workspace },
    });
    let config: BranchConfig = {};
    await applyGroveAddPlan(currentAddPlan, {
      env,
      nowMs: 10,
      consentPlanIntegrity: currentAddPlan.planIntegrity,
      commitConfig: async (transform) => {
        config = transform(config);
      },
    });
    const originalFiles = readGroveWorkspaceFiles("worker", { env });
    const updatePlan = await buildGroveUpdatePlan({
      agentId: "worker",
      targetManifest: targetParsed.manifest,
      targetGroveMarkdownBody: targetSoul,
      targetSource,
      config,
      sourceMcpServers: {},
      stateOptions: { env },
    });
    const targetAddPlan = await buildGroveAddPlan({
      manifest: targetParsed.manifest,
      groveMarkdownBody: targetSoul,
      source: targetSource,
      context: { agentId: "worker", workspace },
    });
    expect(JSON.stringify(updatePlan)).not.toContain("target soul");

    const execution = await applyGroveWorkspaceUpdate(updatePlan, targetAddPlan, {
      env,
      nowMs: 20,
    });

    await expect(readFile(join(workspace, "SOUL.md"), "utf8")).resolves.toBe("target soul\n");
    await expect(readFile(join(workspace, "NEW.md"), "utf8")).resolves.toBe("new\n");
    await expect(access(join(workspace, "OLD.md"))).rejects.toThrow();
    expect(readGroveWorkspaceFiles("worker", { env })).toEqual([
      expect.objectContaining({ path: "NEW.md", sourcePath: "NEW.md" }),
      expect.objectContaining({ path: "SOUL.md", sourcePath: "GROVE.md" }),
    ]);

    await execution.rollback();

    await expect(readFile(join(workspace, "SOUL.md"), "utf8")).resolves.toBe("current soul\n");
    await expect(readFile(join(workspace, "OLD.md"), "utf8")).resolves.toBe("old\n");
    await expect(access(join(workspace, "NEW.md"))).rejects.toThrow();
    expect(readGroveWorkspaceFiles("worker", { env })).toEqual(originalFiles);

    await rm(join(workspace, "OLD.md"));
    await expect(
      applyGroveWorkspaceUpdate(updatePlan, targetAddPlan, { env, nowMs: 30 }),
    ).rejects.toThrow("disappeared after planning");
  });
});
