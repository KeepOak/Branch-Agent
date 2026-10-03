import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import { persistGroveInstallRecord, readGroveInstallRecord } from "./provenance.js";
import { makeProvenancePlan, stateEnv } from "./provenance.test-helpers.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(() => {
  closeBranchStateDatabaseForTest();
});

async function makePlan() {
  const root = tempDirs.make("branch-grove-provenance-schema-");
  return await makeProvenancePlan(root, { schemaVersion: 1, agent: { id: "worker" } });
}

function downgradeInstallRecord(root: string): void {
  const env = stateEnv(root);
  openBranchStateDatabase({ env })
    .db /* sqlite-allow-raw: test-only downgrade simulates pre-v2 provenance. */
    .prepare("UPDATE grove_installs SET schema_version = ? WHERE agent_id = ?")
    .run("branch.groveInstallRecord.v1", "worker");
}

describe("Grove install provenance schema migration", () => {
  it("upgrades matching incomplete v1 provenance from an exact resume handoff", async () => {
    const { root, plan } = await makePlan();
    const env = stateEnv(root);
    persistGroveInstallRecord(plan, { env, status: "pending", nowMs: 1 });
    downgradeInstallRecord(root);
    const legacyRecord = readGroveInstallRecord("worker", { env });
    if (!legacyRecord) {
      throw new Error("expected legacy install record");
    }

    const resumed = persistGroveInstallRecord(plan, {
      env,
      status: "pending",
      nowMs: 2,
      expectedExistingRecord: legacyRecord,
    });

    expect(resumed).toMatchObject({
      schemaVersion: "branch.groveInstallRecord.v2",
      status: "pending",
      addedAtMs: 1,
      updatedAtMs: 1,
    });
  });

  it("atomically replaces legacy plan identity with the bounded resume plan", async () => {
    const { root, plan: legacyPlan } = await makePlan();
    const env = stateEnv(root);
    persistGroveInstallRecord(legacyPlan, { env, status: "pending", nowMs: 1 });
    downgradeInstallRecord(root);
    const legacyRecord = readGroveInstallRecord("worker", { env });
    if (!legacyRecord) {
      throw new Error("expected legacy install record");
    }
    const boundedPlan = {
      ...legacyPlan,
      planIntegrity: "sha256:bounded-plan",
      agent: {
        ...legacyPlan.agent,
        config: {
          ...legacyPlan.agent.config,
          tools: { profile: "full" as const, allow: ["read"] },
        },
      },
    };

    const resumed = persistGroveInstallRecord(boundedPlan, {
      env,
      status: "pending",
      nowMs: 2,
      expectedExistingRecord: legacyRecord,
      expectedExistingPlan: legacyPlan,
    });

    expect(resumed).toMatchObject({
      schemaVersion: "branch.groveInstallRecord.v2",
      planIntegrity: boundedPlan.planIntegrity,
      status: "pending",
      addedAtMs: 1,
      updatedAtMs: 1,
    });
    expect(resumed.agentConfigDigest).not.toBe(legacyRecord.agentConfigDigest);
    expect(readGroveInstallRecord("worker", { env })).toEqual(resumed);
  });

  it("can defer the legacy identity replacement until config migration succeeds", async () => {
    const { root, plan: legacyPlan } = await makePlan();
    const env = stateEnv(root);
    persistGroveInstallRecord(legacyPlan, { env, status: "workspace_ready", nowMs: 1 });
    downgradeInstallRecord(root);
    const legacyRecord = readGroveInstallRecord("worker", { env });
    if (!legacyRecord) {
      throw new Error("expected legacy install record");
    }
    const boundedPlan = {
      ...legacyPlan,
      planIntegrity: "sha256:bounded-plan",
    };

    const deferred = persistGroveInstallRecord(boundedPlan, {
      env,
      status: "pending",
      expectedExistingRecord: legacyRecord,
      expectedExistingPlan: legacyPlan,
      deferLegacyPlanUpgrade: true,
    });

    expect(deferred).toEqual(legacyRecord);
    expect(readGroveInstallRecord("worker", { env })).toEqual(legacyRecord);
  });

  it("does not upgrade a v1 record outside an exact resume handoff", async () => {
    const { root, plan } = await makePlan();
    const env = stateEnv(root);
    persistGroveInstallRecord(plan, { env, status: "partial", nowMs: 1 });
    downgradeInstallRecord(root);

    expect(() => persistGroveInstallRecord(plan, { env, status: "pending", nowMs: 2 })).toThrow(
      "not an exact resumable attempt",
    );
    expect(readGroveInstallRecord("worker", { env })).toMatchObject({
      schemaVersion: "branch.groveInstallRecord.v1",
      status: "partial",
    });
  });
});
