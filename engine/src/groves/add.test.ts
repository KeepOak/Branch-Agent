import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { BranchConfig } from "../config/config.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import { applyGroveAddPlan } from "./add.js";
import { readGroveStatus } from "./lifecycle-state.js";
import { buildGroveAddPlan } from "./lifecycle.js";
import { persistGroveInstallRecord, readGroveInstallRecord } from "./provenance.js";
import { makeProvenancePlan, stateEnv } from "./provenance.test-helpers.js";
import type { GroveBranchProfile } from "./types.js";
import { applyGroveUpdatePlan } from "./update-apply.js";
import { consent, manifest, source } from "./update-apply.test-helpers.js";
import { buildGroveUpdatePlan } from "./update-plan.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(() => {
  closeBranchStateDatabaseForTest();
});

describe("Grove add lifecycle", () => {
  it("applies, tracks drift, updates, and removes profile model and delegation settings", async () => {
    const root = tempDirs.make("branch-grove-update-profile-");
    const env = { BRANCH_STATE_DIR: join(root, "state") };
    const localSource = { ...source, packageRoot: root };
    const agentProfile: GroveBranchProfile["agent"] = {
      model: { primary: "acme/primary", fallbacks: ["acme/fallback"] },
      subagents: { allowAgents: ["researcher"], delegationMode: "prefer" },
    };
    const initial = await buildGroveAddPlan({
      manifest,
      source: localSource,
      branchProfile: { schemaVersion: 1, agent: agentProfile },
      context: { workspace: join(root, "workspace") },
    });
    let config: BranchConfig = {};
    const commitConfig = async (transform: (current: BranchConfig) => BranchConfig) => {
      config = transform(config);
    };
    await applyGroveAddPlan(initial, {
      env,
      commitConfig,
      consentPlanIntegrity: initial.planIntegrity,
    });
    expect(config.agents?.entries?.worker).toMatchObject(agentProfile);
    await expect(readGroveStatus("worker", { env, config })).resolves.toMatchObject({
      records: [{ agentState: "present" }],
    });
    for (const change of [
      { model: { primary: "acme/operator" } },
      { subagents: { allowAgents: [] } },
    ]) {
      const modified = structuredClone(config);
      Object.assign(modified.agents!.entries!.worker!, change);
      await expect(readGroveStatus("worker", { env, config: modified })).resolves.toMatchObject({
        records: [{ agentState: "modified" }],
      });
    }
    const targetProfiles: GroveBranchProfile["agent"][] = [
      {
        model: { primary: "acme/replacement", fallbacks: [] },
        subagents: { allowAgents: [], delegationMode: "suggest" },
      },
      {},
    ];
    for (const agent of targetProfiles) {
      const target = {
        targetManifest: manifest,
        targetSource: localSource,
        targetBranchProfile: { schemaVersion: 1 as const, agent },
      };
      const update = await buildGroveUpdatePlan({
        ...target,
        agentId: "worker",
        config,
        sourceMcpServers: {},
        stateOptions: { env },
      });
      expect(update.blockers).toEqual([]);
      expect(update.actions).toContainEqual(
        expect.objectContaining({ kind: "agent", action: "change" }),
      );
      expect(update.capabilityChanges.map((change) => change.path)).toEqual(
        expect.arrayContaining([
          "agent.model",
          "agent.subagents.allowAgents",
          "agent.subagents.delegationMode",
        ]),
      );
      await expect(
        applyGroveUpdatePlan(update, target, {
          env,
          config,
          commitConfig,
          ...consent(update),
        }),
      ).resolves.toMatchObject({ status: "complete" });
      expect(config.agents?.entries?.worker?.model).toEqual(agent.model);
      expect(config.agents?.entries?.worker?.subagents).toEqual(agent.subagents);
      await expect(readGroveStatus("worker", { env, config })).resolves.toMatchObject({
        records: [{ agentState: "present" }],
      });
    }
  });

  it("records a failed config commit only after persistence resolves", async () => {
    const root = tempDirs.make("branch-grove-add-commit-failure-");
    const env = stateEnv(root);
    const { plan } = await makeProvenancePlan(root, {
      schemaVersion: 1,
      agent: { id: "worker" },
    });

    const result = await applyGroveAddPlan(plan, {
      consentPlanIntegrity: plan.planIntegrity,
      env,
      commitConfig: async (transform) => {
        transform({});
        throw new Error("config unavailable after transform");
      },
    });

    expect(result).toMatchObject({
      status: "partial",
      workspaceCreated: false,
      configCommitted: false,
      installRecord: { status: "partial" },
      error: { code: "config_commit_failed", message: "config unavailable after transform" },
    });
    await expect(access(plan.agent.workspace)).rejects.toThrow();
    expect(readGroveInstallRecord("worker", { env })?.status).toBe("partial");
  });

  it("retries after v1 promotion fails behind the bounded config commit", async () => {
    const root = tempDirs.make("branch-grove-add-v1-promotion-retry-");
    const env = stateEnv(root);
    const { plan } = await makeProvenancePlan(root, {
      schemaVersion: 1,
      agent: { id: "worker" },
    });
    const legacyPlan = {
      ...plan,
      planIntegrity: "sha256:legacy-plan",
      agent: {
        ...plan.agent,
        config: {
          ...plan.agent.config,
          tools: { profile: "coding" as const },
        },
      },
    };
    const boundedPlan = {
      ...plan,
      planIntegrity: "sha256:bounded-plan",
      agent: {
        ...plan.agent,
        config: {
          ...plan.agent.config,
          tools: { profile: "full" as const, allow: ["read"] },
        },
      },
    };
    await mkdir(boundedPlan.agent.workspace, { recursive: true });
    persistGroveInstallRecord(legacyPlan, { env, status: "workspace_ready", nowMs: 1 });
    openBranchStateDatabase({ env })
      .db /* sqlite-allow-raw: test-only downgrade simulates an interrupted v1 add. */
      .prepare("UPDATE grove_installs SET schema_version = ? WHERE agent_id = ?")
      .run("branch.groveInstallRecord.v1", "worker");
    const legacyRecord = readGroveInstallRecord("worker", { env });
    if (!legacyRecord) {
      throw new Error("expected legacy install record");
    }
    let config: BranchConfig = {
      agents: {
        entries: {
          worker: Object.fromEntries(
            Object.entries(legacyPlan.agent.config).filter(([key]) => key !== "id"),
          ),
        },
      },
    };
    const commitConfig = async (transform: (config: BranchConfig) => BranchConfig) => {
      config = transform(config);
    };
    const dependencies = {
      env,
      consentPlanIntegrity: legacyPlan.planIntegrity,
      resumeRecord: legacyRecord,
      resumePlan: legacyPlan,
      commitConfig,
      seedPackageBootstrap: async () => undefined,
      createWorkspaceFiles: async () => [],
      installPackages: async () => [],
      installMcpServers: async () => [],
      installCronJobs: async () => [],
    };
    const persistRecord = vi
      .fn<typeof persistGroveInstallRecord>()
      .mockImplementationOnce((...args) => persistGroveInstallRecord(...args))
      .mockImplementationOnce(() => {
        throw new Error("injected v1 promotion failure");
      });

    const first = await applyGroveAddPlan(boundedPlan, { ...dependencies, persistRecord });

    expect(first).toMatchObject({
      status: "partial",
      configCommitted: true,
      error: { message: "injected v1 promotion failure" },
    });
    expect(config.agents?.entries?.worker).toMatchObject({
      tools: { profile: "full", allow: ["read"] },
    });
    expect(readGroveInstallRecord("worker", { env })).toMatchObject({
      schemaVersion: "branch.groveInstallRecord.v1",
      planIntegrity: legacyPlan.planIntegrity,
      status: "workspace_ready",
    });

    const second = await applyGroveAddPlan(boundedPlan, dependencies);

    expect(second.status).toBe("complete");
    expect(readGroveInstallRecord("worker", { env })).toMatchObject({
      schemaVersion: "branch.groveInstallRecord.v2",
      planIntegrity: boundedPlan.planIntegrity,
      status: "complete",
    });
  });
});
