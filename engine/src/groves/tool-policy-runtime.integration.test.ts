import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { createExecTool } from "../agents/bash-tools.exec-run.js";
import { resolveConversationCapabilityProfile } from "../agents/conversation-capability-profile.js";
import {
  buildConversationToolPolicyPipelineSteps,
  resolveConversationToolPolicies,
} from "../agents/conversation-tool-policy-pipeline.js";
import { createReadTool } from "../agents/sessions/tools/read.js";
import { applyToolPolicyPipeline } from "../agents/tool-policy-pipeline.js";
import {
  createToolSearchCatalogRef,
  registerHeadlessToolSearchCatalog,
} from "../agents/tool-search-catalog.js";
import { resolveToolSearchConfig } from "../agents/tool-search-config.js";
import { ToolSearchRuntime } from "../agents/tool-search-runtime.js";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../config/runtime-snapshot.js";
import type { BranchConfig } from "../config/types.branch.js";
import * as sqliteSnapshot from "../infra/sqlite-snapshot-source.js";
import { withArtifactPreservingStateReads } from "../state/branch-state-db-readonly.js";
import {
  closeBranchStateDatabase,
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { applyGroveMigrationPlan, buildGroveMigrationPlan } from "./migrate.js";
import { persistGroveInstallRecord } from "./provenance.js";
import { makeProvenancePlan, stateEnv } from "./provenance.test-helpers.js";
import { prepareCapturedGroveToolPolicyConsent } from "./tool-policy-runtime.js";
import type { GroveBranchProfile } from "./types.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(() => {
  closeBranchStateDatabaseForTest();
  clearRuntimeConfigSnapshot();
  vi.unstubAllEnvs();
});

function makeToolConsentPlan(
  root: string,
  tools: NonNullable<GroveBranchProfile["agent"]["tools"]> = { profile: "full", allow: ["read"] },
  agentId = "worker",
) {
  return makeProvenancePlan(
    root,
    { schemaVersion: 1, agent: { id: agentId } },
    {
      branchProfile: { schemaVersion: 1, agent: { tools } },
    },
  );
}

async function migrateToolConsentAgent() {
  const root = tempDirs.make("branch-adopted-grove-tool-consent-");
  const env = stateEnv(root);
  vi.stubEnv("BRANCH_STATE_DIR", env.BRANCH_STATE_DIR);
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "AGENTS.md"), "Use the existing workspace.\n");
  const config = {
    agents: {
      defaults: {
        workspace: root,
        model: "openai/gpt-4.1",
        sandbox: { mode: "all" as const },
      },
      entries: {
        worker: { workspace, tools: { profile: "full" as const, allow: ["read"] } },
      },
    },
  };
  const migration = await buildGroveMigrationPlan({ agentId: "worker", config, options: { env } });
  await applyGroveMigrationPlan({ migration, config, options: { env } });
  return { root, config, env };
}

describe("Grove tool policy consent provenance", () => {
  it("runs an adopted agent with frozen tools and inherited settings after restart", async () => {
    const { config, env } = await migrateToolConsentAgent();
    const workspace = config.agents.entries.worker.workspace;
    const read = createReadTool(workspace);
    const exec = createExecTool({ cwd: workspace, host: "gateway", security: "full", ask: "off" });
    const executeRead = vi.spyOn(read, "execute");
    const executeExec = vi.spyOn(exec, "execute");
    const marker = join(workspace, "forbidden-exec-marker");
    const execInput = { command: "touch forbidden-exec-marker" };
    const prepareDispatcher = (activeConfig: BranchConfig) => {
      const capabilityProfile = resolveConversationCapabilityProfile({
        agentId: "worker",
        config: activeConfig,
      });
      const policies = resolveConversationToolPolicies({ capabilityProfile });
      const filtered = applyToolPolicyPipeline({
        tools: [read, exec, { ...read, name: "future_tool" }],
        toolMeta: (tool) => (tool.name === "future_tool" ? { pluginId: "read" } : undefined),
        warn: () => {},
        steps: buildConversationToolPolicyPipelineSteps({
          capabilityProfile,
          policies,
          includeRuntimeToolPolicy: true,
        }),
      });
      expect(filtered.map((tool) => tool.name)).toEqual(["read"]);
      const catalogRef = createToolSearchCatalogRef();
      registerHeadlessToolSearchCatalog({ catalogRef, tools: filtered });
      return new ToolSearchRuntime({ catalogRef }, resolveToolSearchConfig(), {
        validateInput: true,
      });
    };
    closeBranchStateDatabase();
    setRuntimeConfigSnapshot(config);
    const captured = structuredClone(config);
    prepareCapturedGroveToolPolicyConsent(captured, { env });
    const dispatcher = prepareDispatcher(captured);
    const readResult = await dispatcher.call("read", { path: "AGENTS.md" });
    expect(readResult.result.content).toContainEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Use the existing workspace."),
      }),
    );
    expect(executeRead).toHaveBeenCalledOnce();
    await expect(dispatcher.call("exec", execInput)).rejects.toThrow("Unknown tool");
    expect(executeExec).not.toHaveBeenCalled();
    expect(existsSync(marker)).toBe(false);

    const changedConfigs: BranchConfig[] = [
      {
        agents: {
          ...config.agents,
          defaults: { ...config.agents.defaults, model: "openai/gpt-4.1-mini" },
        },
      },
      {
        agents: {
          ...config.agents,
          defaults: { ...config.agents.defaults, sandbox: { mode: "off" } },
        },
      },
      {
        agents: {
          ...config.agents,
          defaults: { ...config.agents.defaults, compaction: { mode: "default" } },
        },
      },
      {
        agents: {
          ...config.agents,
          entries: {
            worker: {
              ...config.agents.entries.worker,
              tools: { profile: "full", allow: ["read", "exec"] },
            },
          },
        },
      },
    ];
    for (const changed of changedConfigs) {
      setRuntimeConfigSnapshot(changed);
      await expect(
        (async () => prepareDispatcher(changed).call("exec", execInput))(),
      ).rejects.toThrow("Cannot verify the installed tool authority");
    }
    setRuntimeConfigSnapshot(config);
    openBranchStateDatabase({ env });
    closeBranchStateDatabase();
    await expect((async () => prepareDispatcher(config).call("exec", execInput))()).rejects.toThrow(
      "Cannot verify the installed tool authority",
    );
    expect(executeRead).toHaveBeenCalledOnce();
    expect(executeExec).not.toHaveBeenCalled();
    expect(existsSync(marker)).toBe(false);
  });

  it("keeps mixed legacy, created, and adopted consent isolated after restart", async () => {
    const { root, config, env } = await migrateToolConsentAgent();
    mkdirSync(join(root, "created"));
    mkdirSync(join(root, "legacy"));
    const { plan: created } = await makeToolConsentPlan(
      join(root, "created"),
      undefined,
      "created",
    );
    const { plan: legacy } = await makeToolConsentPlan(join(root, "legacy"), undefined, "legacy");
    persistGroveInstallRecord(created, { env });
    persistGroveInstallRecord(legacy, { env });
    openBranchStateDatabase({ env })
      .db
      /* sqlite-allow-raw: test-only downgrade verifies mixed stored consent versions. */
      .prepare("UPDATE grove_installs SET schema_version = ? WHERE agent_id = ?")
      .run("branch.groveInstallRecord.v1", "legacy");
    closeBranchStateDatabase();
    const mixedConfig = {
      agents: {
        ...config.agents,
        entries: {
          ...config.agents.entries,
          created: created.agent.config,
          legacy: legacy.agent.config,
        },
      },
    };
    setRuntimeConfigSnapshot(mixedConfig);
    for (const agentId of ["worker", "created"]) {
      expect(() =>
        resolveConversationCapabilityProfile({ agentId, config: mixedConfig }),
      ).not.toThrow();
    }
    expect(() =>
      resolveConversationCapabilityProfile({ agentId: "legacy", config: mixedConfig }),
    ).toThrow("legacy dynamic tool policy");
  });

  it("refreshes runtime consent without copying the live database on each catalog generation", async () => {
    const root = tempDirs.make("branch-grove-runtime-consent-");
    const env = stateEnv(root);
    vi.stubEnv("BRANCH_STATE_DIR", env.BRANCH_STATE_DIR);
    const { plan } = await makeProvenancePlan(
      root,
      { schemaVersion: 1, agent: { id: "worker" } },
      {
        branchProfile: {
          schemaVersion: 1,
          agent: { tools: { profile: "full", allow: ["read"] } },
        },
      },
    );
    persistGroveInstallRecord(plan, { env });
    const databasePath = resolveBranchStateSqlitePath(env);
    closeBranchStateDatabase();
    const external = new DatabaseSync(databasePath);
    const snapshot = vi.spyOn(sqliteSnapshot, "prepareSqliteReadOnlyLocationSync");
    const config = { agents: { list: [plan.agent.config] } };
    try {
      setRuntimeConfigSnapshot(config);
      expect(() =>
        resolveConversationCapabilityProfile({ agentId: "worker", config }),
      ).not.toThrow();
      external
        .prepare("UPDATE grove_installs SET schema_version = ? WHERE agent_id = ?")
        .run("branch.groveInstallRecord.v1", "worker");
      setRuntimeConfigSnapshot(config);
      expect(() => resolveConversationCapabilityProfile({ agentId: "worker", config })).toThrow(
        "legacy dynamic tool policy",
      );
      expect(snapshot).not.toHaveBeenCalled();

      withArtifactPreservingStateReads(() => setRuntimeConfigSnapshot(config));
      expect(snapshot).toHaveBeenCalledOnce();
      expect(() => resolveConversationCapabilityProfile({ agentId: "worker", config })).toThrow(
        "legacy dynamic tool policy",
      );
    } finally {
      snapshot.mockRestore();
      external.close();
    }
  });

  it("does not create writable state for an ordinary named profile", () => {
    const root = tempDirs.make("branch-non-grove-tool-consent-");
    vi.stubEnv("BRANCH_STATE_DIR", join(root, "state"));
    const config = { agents: { list: [{ id: "worker", tools: { profile: "coding" as const } }] } };
    setRuntimeConfigSnapshot(config);

    expect(() =>
      resolveConversationCapabilityProfile({
        agentId: "worker",
        config,
      }),
    ).not.toThrow();
    expect(existsSync(join(root, "state"))).toBe(false);
  });

  it("does not infer Grove ownership before consent provenance is initialized", () => {
    const root = tempDirs.make("branch-uninitialized-grove-tool-consent-");
    const stateDir = join(root, "state");
    vi.stubEnv("BRANCH_STATE_DIR", stateDir);
    const config = {
      agents: {
        list: [{ id: "worker", tools: { profile: "full" as const, allow: ["read"] } }],
      },
    };
    setRuntimeConfigSnapshot(config);

    expect(() =>
      resolveConversationCapabilityProfile({
        agentId: "worker",
        config,
      }),
    ).not.toThrow();
    expect(existsSync(stateDir)).toBe(false);
  });

  it("fails an ordinary named profile closed when initial ownership is unreadable", () => {
    const root = tempDirs.make("branch-unreadable-non-grove-tool-consent-");
    const stateDir = join(root, "state");
    const env = { BRANCH_STATE_DIR: stateDir };
    const databasePath = resolveBranchStateSqlitePath(env);
    mkdirSync(dirname(databasePath), { recursive: true });
    writeFileSync(databasePath, "not a sqlite database");
    const before = readFileSync(databasePath);
    vi.stubEnv("BRANCH_STATE_DIR", env.BRANCH_STATE_DIR);

    const config = {
      agents: {
        list: [{ id: "worker", tools: { profile: "coding" as const } }],
      },
    };
    setRuntimeConfigSnapshot(config);

    expect(() =>
      resolveConversationCapabilityProfile({
        agentId: "worker",
        config,
      }),
    ).toThrow("Cannot verify the installed tool authority");
    expect(readFileSync(databasePath)).toEqual(before);
  });

  it("fails a known Grove closed without mutating unreadable consent provenance", async () => {
    const root = tempDirs.make("branch-unreadable-grove-tool-consent-");
    const stateDir = join(root, "state");
    const env = { BRANCH_STATE_DIR: stateDir };
    const databasePath = resolveBranchStateSqlitePath(env);
    vi.stubEnv("BRANCH_STATE_DIR", env.BRANCH_STATE_DIR);
    const { plan } = await makeToolConsentPlan(root);
    persistGroveInstallRecord(plan, { env });
    closeBranchStateDatabase();
    writeFileSync(databasePath, "not a sqlite database");
    const before = readFileSync(databasePath);

    const config = { agents: { list: [plan.agent.config] } };
    expect(() => openBranchStateDatabase({ env })).toThrow();
    setRuntimeConfigSnapshot(config);

    expect(() =>
      resolveConversationCapabilityProfile({
        agentId: "worker",
        config,
      }),
    ).toThrow("Cannot verify the installed tool authority");
    expect(readFileSync(databasePath)).toEqual(before);
  });

  it("fails closed after the prepared state database closes", async () => {
    const root = tempDirs.make("branch-closed-grove-tool-consent-");
    const env = stateEnv(root);
    vi.stubEnv("BRANCH_STATE_DIR", env.BRANCH_STATE_DIR);
    const { plan } = await makeToolConsentPlan(root);
    persistGroveInstallRecord(plan, { env });
    const config = { agents: { list: [plan.agent.config] } };
    setRuntimeConfigSnapshot(config);
    closeBranchStateDatabase();

    expect(() =>
      resolveConversationCapabilityProfile({
        agentId: "worker",
        config,
      }),
    ).toThrow("Cannot verify the installed tool authority");
  });

  it("fails closed when the active agent config does not match consent provenance", async () => {
    const root = tempDirs.make("branch-modified-grove-tool-consent-");
    const env = stateEnv(root);
    vi.stubEnv("BRANCH_STATE_DIR", env.BRANCH_STATE_DIR);
    const { plan } = await makeToolConsentPlan(root);
    persistGroveInstallRecord(plan, { env });
    const config = {
      agents: {
        list: [
          {
            ...plan.agent.config,
            tools: { profile: "full" as const, allow: ["read", "exec"] },
          },
        ],
      },
    };
    setRuntimeConfigSnapshot(config);

    expect(() =>
      resolveConversationCapabilityProfile({
        agentId: "worker",
        config,
      }),
    ).toThrow("Cannot verify the installed tool authority");
  });

  it("fails closed after a host upgrade leaves legacy profile provenance", async () => {
    const root = tempDirs.make("branch-grove-tool-consent-");
    const env = stateEnv(root);
    vi.stubEnv("BRANCH_STATE_DIR", join(root, "state"));
    const { plan } = await makeToolConsentPlan(root, { profile: "coding", allow: ["read"] });
    persistGroveInstallRecord(plan, { env });

    const config = { agents: { list: [plan.agent.config] } };
    setRuntimeConfigSnapshot(config);
    const capabilityProfile = resolveConversationCapabilityProfile({
      agentId: "worker",
      config,
    });
    const policies = resolveConversationToolPolicies({ capabilityProfile });
    const filtered = applyToolPolicyPipeline({
      tools: [{ name: "read" }, { name: "future_tool" }],
      toolMeta: (tool) => (tool.name === "future_tool" ? { pluginId: "read" } : undefined),
      warn: () => {},
      steps: buildConversationToolPolicyPipelineSteps({
        capabilityProfile,
        policies,
        includeRuntimeToolPolicy: true,
      }),
    });
    expect(filtered.map((tool) => tool.name)).toEqual(["read"]);

    openBranchStateDatabase({ env })
      .db /* sqlite-allow-raw: test-only downgrade simulates an install created by the previous host. */
      .prepare("UPDATE grove_installs SET schema_version = ? WHERE agent_id = ?")
      .run("branch.groveInstallRecord.v1", "worker");
    closeBranchStateDatabase();
    openBranchStateDatabase({ env });

    const legacyConfig = {
      agents: {
        list: [
          {
            ...plan.agent.config,
            tools: { profile: "coding" as const },
          },
        ],
      },
    };
    setRuntimeConfigSnapshot(legacyConfig);
    expect(() =>
      resolveConversationCapabilityProfile({
        agentId: "worker",
        config: legacyConfig,
      }),
    ).toThrow("uses a legacy dynamic tool policy");
  });

  it("gives a legacy unbounded full profile an actionable repair path", async () => {
    const root = tempDirs.make("branch-grove-full-tool-consent-");
    const env = stateEnv(root);
    vi.stubEnv("BRANCH_STATE_DIR", join(root, "state"));
    const { plan } = await makeToolConsentPlan(root);
    persistGroveInstallRecord(plan, { env });
    openBranchStateDatabase({ env })
      .db /* sqlite-allow-raw: test-only downgrade simulates a legacy unbounded full profile. */
      .prepare("UPDATE grove_installs SET schema_version = ? WHERE agent_id = ?")
      .run("branch.groveInstallRecord.v1", "worker");
    closeBranchStateDatabase();
    openBranchStateDatabase({ env });

    const config = {
      agents: {
        list: [
          {
            ...plan.agent.config,
            tools: { profile: "full" as const },
          },
        ],
      },
    };
    setRuntimeConfigSnapshot(config);

    expect(() =>
      resolveConversationCapabilityProfile({
        agentId: "worker",
        config,
      }),
    ).toThrow(
      "Add an explicit tools.allow list to its package Branch Agent profile, then run `branch groves update worker`",
    );
  });

  it("isolates an unsupported install record from other agents", async () => {
    const root = tempDirs.make("branch-grove-tool-consent-isolation-");
    const env = stateEnv(root);
    const validRoot = join(root, "valid");
    const invalidRoot = join(root, "invalid");
    mkdirSync(validRoot);
    mkdirSync(invalidRoot);
    vi.stubEnv("BRANCH_STATE_DIR", env.BRANCH_STATE_DIR);
    const { plan: validPlan } = await makeToolConsentPlan(
      validRoot,
      { profile: "full", allow: ["read"] },
      "valid",
    );
    const { plan: invalidPlan } = await makeToolConsentPlan(
      invalidRoot,
      { profile: "full", allow: ["read"] },
      "invalid",
    );
    persistGroveInstallRecord(validPlan, { env });
    persistGroveInstallRecord(invalidPlan, { env });
    openBranchStateDatabase({ env })
      .db /* sqlite-allow-raw: test-only corruption verifies per-agent failure isolation. */
      .prepare("UPDATE grove_installs SET schema_version = ? WHERE agent_id = ?")
      .run("branch.groveInstallRecord.unsupported", "invalid");
    closeBranchStateDatabase();
    openBranchStateDatabase({ env });

    const config = { agents: { list: [validPlan.agent.config, invalidPlan.agent.config] } };
    setRuntimeConfigSnapshot(config);

    expect(() =>
      resolveConversationCapabilityProfile({
        agentId: "valid",
        config,
      }),
    ).not.toThrow();
    expect(() =>
      resolveConversationCapabilityProfile({
        agentId: "invalid",
        config,
      }),
    ).toThrow("Cannot verify the installed tool authority");
  });

  it("does not intersect a standalone Grove allowlist with the host profile", async () => {
    const root = tempDirs.make("branch-grove-standalone-tool-consent-");
    const env = stateEnv(root);
    vi.stubEnv("BRANCH_STATE_DIR", join(root, "state"));
    const { plan } = await makeToolConsentPlan(root, { allow: ["read"] });
    persistGroveInstallRecord(plan, { env });

    const config = {
      tools: { profile: "minimal" as const },
      agents: { list: [plan.agent.config] },
    };
    setRuntimeConfigSnapshot(config);
    const capabilityProfile = resolveConversationCapabilityProfile({
      agentId: "worker",
      config,
    });
    const policies = resolveConversationToolPolicies({
      capabilityProfile,
      additionalPolicyAllow: ["message", "tool_search"],
    });
    const filtered = applyToolPolicyPipeline({
      tools: [{ name: "read" }, { name: "exec" }, { name: "message" }, { name: "tool_search" }],
      toolMeta: () => undefined,
      warn: () => {},
      steps: buildConversationToolPolicyPipelineSteps({
        capabilityProfile,
        policies,
        includeRuntimeToolPolicy: true,
      }),
    });

    expect(plan.agent.config.tools).toEqual({ profile: "full", allow: ["read"] });
    expect(filtered.map((tool) => tool.name)).toEqual(["read"]);
  });
});
