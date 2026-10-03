import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { BranchConfig } from "../config/types.branch.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { readGroveStatus } from "./lifecycle-status.js";
import { applyGroveMigrationPlan, buildGroveMigrationPlan } from "./migrate.js";
import { readGroveInstallRecord } from "./provenance.js";
import { applyGroveUpdatePlan } from "./update-apply.js";
import { buildGroveUpdatePlan } from "./update-plan.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(closeBranchStateDatabaseForTest);

async function fixture() {
  const root = tempDirs.make("branch-adopted-update-");
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const env = { BRANCH_STATE_DIR: join(root, "state") };
  const config: BranchConfig = {
    agents: {
      defaults: { model: "provider/inherited" },
      entries: { worker: { name: "Worker", workspace: `${workspace}/.` } },
    },
  };
  const migration = await buildGroveMigrationPlan({
    agentId: "worker",
    config,
    options: { env },
  });
  await applyGroveMigrationPlan({ migration, config, options: { env } });
  const installed = readGroveInstallRecord("worker", { env });
  const target = {
    targetManifest: {
      ...migration.manifest,
      agent: { ...migration.manifest.agent, name: "Worker v2" },
    },
    // The updated package continues to inherit the host model.
    targetBranchProfile: { schemaVersion: 1 as const, agent: {} },
    targetSource: { ...migration.addPlan.grove, version: "2.0.0", integrity: "sha256:updated" },
  };
  const plan = await buildGroveUpdatePlan({
    agentId: "worker",
    ...target,
    config,
    sourceMcpServers: {},
    stateOptions: { env },
  });
  expect(plan.blockers).toEqual([]);
  expect(plan.actions).toContainEqual(
    expect.objectContaining({ kind: "agent", action: "change", blocked: false }),
  );
  return { config, env, installed, plan, target, workspace: migration.plan.workspace };
}

describe("updating an adopted agent", () => {
  it("updates a present agent with inherited settings and keeps status consistent", async () => {
    const current = await fixture();
    let config = current.config;

    await expect(
      applyGroveUpdatePlan(current.plan, current.target, {
        config,
        env: current.env,
        sourceMcpServers: {},
        consentPlanIntegrity: current.plan.planIntegrity,
        commitConfig: async (transform) => {
          config = transform(config);
        },
      }),
    ).resolves.toMatchObject({ status: "complete", installRecord: { agentOrigin: "adopted" } });

    expect(config.agents?.entries?.worker).toEqual({
      name: "Worker v2",
      workspace: current.workspace,
    });
    expect(config.agents?.defaults).toEqual(current.config.agents?.defaults);
    await expect(
      readGroveStatus("worker", { config, env: current.env, sourceMcpServers: {} }),
    ).resolves.toMatchObject({ records: [{ agentState: "present" }] });
  });

  it("restores the original authored entry when a later update step fails", async () => {
    const current = await fixture();
    let config = current.config;
    let reachedCron = false;

    await expect(
      applyGroveUpdatePlan(current.plan, current.target, {
        config,
        env: current.env,
        sourceMcpServers: {},
        consentPlanIntegrity: current.plan.planIntegrity,
        commitConfig: async (transform) => {
          config = transform(config);
        },
        applyCron: async () => {
          reachedCron = true;
          expect(config.agents?.entries?.worker?.name).toBe("Worker v2");
          throw new Error("cron unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "cron_update_failed" });

    expect(reachedCron).toBe(true);
    expect(config).toEqual(current.config);
    expect(readGroveInstallRecord("worker", { env: current.env })).toEqual(current.installed);
    await expect(
      readGroveStatus("worker", { config, env: current.env, sourceMcpServers: {} }),
    ).resolves.toMatchObject({ records: [{ agentState: "present" }] });
  });

  it("preserves a change to inherited settings made before rollback", async () => {
    const current = await fixture();
    let config = current.config;

    await expect(
      applyGroveUpdatePlan(current.plan, current.target, {
        config,
        env: current.env,
        sourceMcpServers: {},
        consentPlanIntegrity: current.plan.planIntegrity,
        commitConfig: async (transform) => {
          config = transform(config);
        },
        applyCron: async () => {
          config = {
            ...config,
            agents: { ...config.agents, defaults: { model: "provider/operator-change" } },
          };
          throw new Error("cron unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "update_partial" });

    expect(config.agents?.defaults?.model).toBe("provider/operator-change");
    expect(config.agents?.entries?.worker?.name).toBe("Worker v2");
    expect(readGroveInstallRecord("worker", { env: current.env })?.status).toBe("partial");
  });
});
