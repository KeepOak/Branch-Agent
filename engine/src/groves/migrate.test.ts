import { access, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  DEFAULT_SUBAGENT_ARCHIVE_AFTER_MINUTES,
  DEFAULT_SUBAGENT_MAX_CONCURRENT,
} from "../config/agent-limits.js";
import type { BranchConfig } from "../config/types.branch.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { applyGroveMigrationPlan, buildGroveMigrationPlan, GroveMigrationError } from "./migrate.js";
import {
  persistGroveMigrationOwnership,
  persistClawPackageRef,
  readGroveInstallRecord,
} from "./provenance.js";
import { GROVE_WORKSPACE_FILE_RECORD_SCHEMA_VERSION, upsertGroveWorkspaceFile } from "./workspace.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => closeBranchStateDatabaseForTest());

async function fixture(agent: Record<string, unknown> = {}) {
  const root = tempDirs.make("branch-grove-migrate-");
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "AGENTS.md"), "# Existing agent\n", "utf8");
  await writeFile(join(workspace, "SOUL.md"), "Use the current voice.\n", "utf8");
  await writeFile(join(workspace, "unrelated.json"), '{"keep":true}\n', "utf8");
  const env = {
    ...process.env,
    HOME: root,
    BRANCH_HOME: root,
    BRANCH_STATE_DIR: join(root, "state"),
  };
  const config = {
    agents: {
      entries: {
        worker: { workspace, ...agent },
      },
    },
  } as unknown as BranchConfig;
  return { root, workspace, env, config };
}

describe("Grove migration planning", () => {
  it("builds a stable read-only plan without creating a package or state database", async () => {
    const { workspace, env, config } = await fixture({
      name: "Existing worker",
      heartbeat: { every: "30m" },
    });
    const first = await buildGroveMigrationPlan({
      agentId: "worker",
      config,
      options: { env },
    });
    const second = await buildGroveMigrationPlan({
      agentId: "worker",
      config,
      options: { env },
    });

    expect(first.plan).toMatchObject({
      schemaVersion: "branch.groveMigrationPlan.v1",
      dryRun: true,
      mutationAllowed: false,
      agentId: "worker",
      workspace,
      workspaceFiles: [
        { path: join(workspace, "AGENTS.md") },
        { path: join(workspace, "SOUL.md") },
      ],
      generatedPackageFiles: [
        { path: "GROVE.md" },
        { path: "package.json" },
        { path: "profiles/branch.yml" },
        { path: "workspace/AGENTS.md" },
      ],
    });
    expect(first.plan.planIntegrity).toBe(second.plan.planIntegrity);
    await expect(access(first.plan.packageRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(resolveBranchStateSqlitePath(env))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("changes the plan when a selected workspace file changes", async () => {
    const { workspace, env, config } = await fixture();
    const plan = await buildGroveMigrationPlan({ agentId: "worker", config, options: { env } });
    await writeFile(join(workspace, "AGENTS.md"), "# Updated agent\n", "utf8");
    const changed = await buildGroveMigrationPlan({ agentId: "worker", config, options: { env } });
    expect(changed.plan.planIntegrity).not.toBe(plan.plan.planIntegrity);
  });

  it("fails closed when a selected prompt file contains likely secret material", async () => {
    const { workspace, env, config } = await fixture();
    await writeFile(join(workspace, "TOOLS.md"), "api_key = abcdef0123456789abcdef\n", "utf8");
    await expect(
      buildGroveMigrationPlan({ agentId: "worker", config, options: { env } }),
    ).rejects.toMatchObject({
      code: "workspace_file_secret_detected",
      path: "$.workspace.TOOLS.md",
    });
  });

  it("fails closed when a selected prompt file is a symbolic link", async () => {
    const { root, workspace, env, config } = await fixture();
    const outside = join(root, "outside.md");
    await writeFile(outside, "# Outside file\n", "utf8");
    await symlink(outside, join(workspace, "IDENTITY.md"));
    await expect(
      buildGroveMigrationPlan({ agentId: "worker", config, options: { env } }),
    ).rejects.toMatchObject({
      code: "workspace_file_unsafe",
      path: "$.workspace.IDENTITY.md",
    });
  });

  it("reports unsupported settings and ambiguous workspace ownership", async () => {
    const { workspace, env, config } = await fixture({ skills: ["local-only"] });
    await expect(
      buildGroveMigrationPlan({ agentId: "worker", config, options: { env } }),
    ).rejects.toMatchObject({ code: "agent_setting_unsupported" });

    const ambiguous = {
      agents: {
        entries: {
          worker: { workspace },
          child: { workspace: join(workspace, "child") },
        },
      },
    } as unknown as BranchConfig;
    await expect(
      buildGroveMigrationPlan({ agentId: "worker", config: ambiguous, options: { env } }),
    ).rejects.toMatchObject({ code: "workspace_ownership_ambiguous" });
  });

  it("resolves symlink aliases when checking another agent's workspace ownership", async () => {
    const { root, workspace, env } = await fixture();
    const child = join(workspace, "child");
    const alias = join(root, "workspace-alias");
    await mkdir(child);
    await symlink(child, alias);
    const config = {
      agents: {
        entries: {
          worker: { workspace },
          child: { workspace: alias },
        },
      },
    } as unknown as BranchConfig;

    await expect(
      buildGroveMigrationPlan({ agentId: "worker", config, options: { env } }),
    ).rejects.toMatchObject({ code: "workspace_ownership_ambiguous" });
  });

  it("does not place the generated package inside another agent's workspace", async () => {
    const { workspace, env } = await fixture();
    const stateWorkspace = join(env.BRANCH_STATE_DIR, "groves");
    await mkdir(stateWorkspace, { recursive: true });
    const config = {
      agents: {
        entries: {
          worker: { workspace },
          other: { workspace: stateWorkspace },
        },
      },
    } as unknown as BranchConfig;
    await expect(
      buildGroveMigrationPlan({ agentId: "worker", config, options: { env } }),
    ).rejects.toMatchObject({ code: "package_destination_owned_by_agent" });
  });

  it("rejects orphan secondary Grove refs during planning and the ownership transaction", async () => {
    const { env, config } = await fixture();
    const migration = await buildGroveMigrationPlan({
      agentId: "worker",
      config,
      options: { env },
    });
    persistClawPackageRef(
      migration.addPlan,
      {
        kind: "plugin",
        source: "clawhub",
        ref: "audit",
        version: "1.0.0",
        integrity: `sha256:${"a".repeat(64)}`,
      },
      { env },
    );

    await expect(
      buildGroveMigrationPlan({ agentId: "worker", config, options: { env } }),
    ).rejects.toMatchObject({ code: "secondary_resources_unclaimed" });
    expect(() =>
      persistGroveMigrationOwnership(migration.addPlan, migration.ownershipFiles, { env }),
    ).toThrow(/unclaimed Grove resource references/u);
    expect(readGroveInstallRecord("worker", { env })).toBeUndefined();
  });

  it("rejects orphan workspace ownership rows during planning and the ownership transaction", async () => {
    const { workspace, env, config } = await fixture();
    const migration = await buildGroveMigrationPlan({
      agentId: "worker",
      config,
      options: { env },
    });
    upsertGroveWorkspaceFile(
      {
        schemaVersion: GROVE_WORKSPACE_FILE_RECORD_SCHEMA_VERSION,
        agentId: "worker",
        workspace,
        path: join(workspace, "unrelated.json"),
        sourcePath: "workspace/unrelated.json",
        contentDigest: `sha256:${"b".repeat(64)}`,
        status: "complete",
        createdAtMs: 1,
        updatedAtMs: 1,
      },
      { env },
    );

    expect(() =>
      persistGroveMigrationOwnership(migration.addPlan, migration.ownershipFiles, { env }),
    ).toThrow(/unclaimed Grove workspace-file ownership record/u);
    expect(readGroveInstallRecord("worker", { env })).toBeUndefined();
    await expect(
      buildGroveMigrationPlan({ agentId: "worker", config, options: { env } }),
    ).rejects.toMatchObject({ code: "workspace_ownership_unclaimed" });
  });

  it("captures a representable inherited default model in the generated package", async () => {
    const { workspace, env } = await fixture();
    const config = {
      agents: {
        defaults: {
          model: { primary: "provider/default", fallbacks: ["provider/fallback"] },
          compaction: { mode: "safeguard" },
          subagents: {
            allowAgents: ["researcher"],
            delegationMode: "prefer",
            maxConcurrent: DEFAULT_SUBAGENT_MAX_CONCURRENT,
            archiveAfterMinutes: DEFAULT_SUBAGENT_ARCHIVE_AFTER_MINUTES,
          },
          heartbeat: { agentId: "worker", every: "45m" },
          sandbox: { mode: "non-main", scope: "agent", workspaceAccess: "rw" },
          humanDelay: { mode: "custom", minMs: 100, maxMs: 300 },
        },
        entries: { worker: { workspace } },
      },
    } as unknown as BranchConfig;
    const migration = await buildGroveMigrationPlan({
      agentId: "worker",
      config,
      options: { env },
    });

    expect(migration.profile?.agent.model).toEqual({
      primary: "provider/default",
      fallbacks: ["provider/fallback"],
    });
    expect(migration.addPlan.agent.config.model).toEqual(migration.profile?.agent.model);
    expect(migration.profile?.agent).toMatchObject({
      subagents: { allowAgents: ["researcher"], delegationMode: "prefer" },
      heartbeat: { every: "45m" },
      sandbox: { mode: "non-main", scope: "agent", workspaceAccess: "rw" },
      humanDelay: { mode: "custom", minMs: 100, maxMs: 300 },
    });
    expect(migration.profile?.agent.heartbeat).not.toHaveProperty("agentId");
  });

  it("migrates a representable string model setting", async () => {
    const { env, config } = await fixture({ model: "provider/model" });
    const migration = await buildGroveMigrationPlan({
      agentId: "worker",
      config,
      options: { env },
    });

    expect(migration.profile?.agent.model).toEqual({ primary: "provider/model" });
  });

  it("fails closed for inherited agent defaults Grove v1 cannot represent", async () => {
    const { workspace, env } = await fixture();
    const config = {
      agents: {
        defaults: {
          compaction: { mode: "default" },
          params: { temperature: 0.2 },
          skills: ["local-only"],
        },
        entries: { worker: { workspace } },
      },
    } as unknown as BranchConfig;

    await expect(
      buildGroveMigrationPlan({ agentId: "worker", config, options: { env } }),
    ).rejects.toMatchObject({
      code: "agent_default_setting_unsupported",
      message: expect.stringContaining("agents.defaults.compaction"),
    });
    await expect(
      buildGroveMigrationPlan({ agentId: "worker", config, options: { env } }),
    ).rejects.toMatchObject({
      code: "agent_default_setting_unsupported",
      message: expect.stringContaining("agents.defaults.params"),
    });
    await expect(
      buildGroveMigrationPlan({ agentId: "worker", config, options: { env } }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("agents.defaults.skills"),
    });
  });

  it("rejects non-default inherited subagent limits that Grove v1 cannot preserve", async () => {
    const { workspace, env } = await fixture();
    const config = {
      agents: {
        defaults: { subagents: { maxConcurrent: 3, archiveAfterMinutes: 90 } },
        entries: { worker: { workspace } },
      },
    } as unknown as BranchConfig;

    await expect(
      buildGroveMigrationPlan({ agentId: "worker", config, options: { env } }),
    ).rejects.toMatchObject({
      code: "agent_default_setting_unsupported",
      message: expect.stringContaining("agents.defaults.subagents.archiveAfterMinutes"),
    });
  });

  it("rejects selected workspace changes after consent and cleans the generated package", async () => {
    const { workspace, env, config } = await fixture();
    const migration = await buildGroveMigrationPlan({
      agentId: "worker",
      config,
      options: { env },
    });
    await writeFile(join(workspace, "AGENTS.md"), "# Changed after consent\n", "utf8");

    await expect(
      applyGroveMigrationPlan({ migration, config, options: { env } }),
    ).rejects.toMatchObject({ code: "workspace_file_changed_after_consent" });
    await expect(access(migration.plan.packageRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(resolveBranchStateSqlitePath(env))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not disclose secret values in diagnostics", async () => {
    const { workspace, env, config } = await fixture();
    const secret = "ghp_0123456789abcdefghijklmnopqrstuv";
    await writeFile(join(workspace, "HEARTBEAT.md"), `token=${secret}\n`, "utf8");
    let failure: unknown;
    try {
      await buildGroveMigrationPlan({ agentId: "worker", config, options: { env } });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(GroveMigrationError);
    expect(String(failure)).not.toContain(secret);
  });

  it.each([
    "Authorization: Bearer bearer-token-value-that-must-not-leak",
    `Authorization: Basic ${Buffer.from("synthetic-user:synthetic-password").toString("base64")}`,
    "session JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepayloadvalue",
    "AWS_SECRET_ACCESS_KEY=0123456789abcdef0123456789abcdef01234567",
    "GITHUB_TOKEN=ghp_0123456789abcdefghijklmnopqrstuv",
  ])("rejects common workspace credential formats", async (secret) => {
    const { workspace, env, config } = await fixture();
    await writeFile(join(workspace, "HEARTBEAT.md"), `${secret}\n`, "utf8");

    let failure: unknown;
    try {
      await buildGroveMigrationPlan({ agentId: "worker", config, options: { env } });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(GroveMigrationError);
    expect(String(failure)).not.toContain(secret);
  });
});
