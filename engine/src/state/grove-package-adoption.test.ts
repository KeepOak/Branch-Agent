import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { awaitGateBeforeSettlement, createDeferred } from "../../test/helpers/promise.js";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { applyClawPackageRemovals, planClawPackageRemovals } from "../groves/package-remove.js";
import {
  persistGroveInstallRecord,
  persistClawPackageRef,
  readClawPackageRefs,
} from "../groves/provenance.js";
import type { GroveAddPlan } from "../groves/types.js";
import { closeStateDatabaseForTest } from "../test-utils/database-cleanup.js";
import { markClawPackageIndependentlyOwned } from "./grove-package-adoption.js";
import { withClawPackageLifecycleLease } from "./grove-package-lifecycle-lease.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(async () => {
    await closeStateDatabaseForTest();
    cleanup();
  });
});

const packageIntegrity = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function plan(agentId: string, workspace: string): GroveAddPlan {
  return {
    schemaVersion: "branch.groveAddPlan.v1",
    manifestSchemaVersion: 1,
    stability: "experimental",
    dryRun: true,
    mutationAllowed: false,
    planIntegrity: `sha256:${agentId}`,
    grove: {
      kind: "package",
      name: `@acme/${agentId}`,
      version: "1.0.0",
      packageRoot: "/tmp/grove",
      manifestPath: "/tmp/grove/GROVE.md",
      integrityKind: "artifact",
      integrity: "sha256:grove",
      byteLength: 100,
    },
    agent: {
      requestedId: agentId,
      finalId: agentId,
      workspace,
      config: { id: agentId, workspace },
    },
    summary: {
      totalActions: 0,
      agentActions: 0,
      workspaceActions: 0,
      packageActions: 0,
      mcpServerActions: 0,
      cronJobActions: 0,
      blockedActions: 0,
      capabilityEscalations: 0,
    },
    actions: [],
    capabilityChanges: [],
    readiness: { ready: true, requirements: [] },
    blockers: [],
    diagnostics: [],
  };
}

describe("Grove package independent adoption", () => {
  it("does not fail an ordinary install when Grove state is unavailable", () => {
    const path = join(tempDirs.make("grove-adoption-invalid-"), "state.sqlite");
    writeFileSync(path, "not sqlite");

    expect(
      markClawPackageIndependentlyOwned(
        {
          kind: "plugin",
          source: "clawhub",
          ref: "@acme/audit",
          version: "1.0.0",
        },
        { path },
      ),
    ).toBe(0);
  });

  it("marks every shared plugin reference independently owned", () => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("grove-adoption-") };
    for (const agentId of ["first", "second"]) {
      const current = plan(agentId, `/tmp/${agentId}`);
      persistGroveInstallRecord(current, { env });
      for (const version of ["1.0.0", "2.0.0"]) {
        persistClawPackageRef(
          current,
          {
            kind: "plugin",
            source: "clawhub",
            ref: "@acme/audit",
            version,
            integrity: packageIntegrity,
          },
          {
            env,
            nowMs: 10,
            relationship: "referenced",
            origin: "grove-introduced",
            independentOwner: false,
          },
        );
      }
    }

    const artifact = {
      kind: "plugin",
      source: "clawhub",
      ref: "@acme/audit",
      version: "1.0.0",
    } as const;
    expect(markClawPackageIndependentlyOwned(artifact, { env, nowMs: 42 })).toBe(2);
    expect(markClawPackageIndependentlyOwned(artifact, { env, nowMs: 99 })).toBe(0);
    const refs = readClawPackageRefs({ env }).toSorted(
      (left, right) =>
        left.agentId.localeCompare(right.agentId) || left.version.localeCompare(right.version),
    );
    expect(refs).toMatchObject([
      { version: "1.0.0", independentOwner: true, updatedAtMs: 42 },
      { version: "2.0.0", independentOwner: false, updatedAtMs: 10 },
      { version: "1.0.0", independentOwner: true, updatedAtMs: 42 },
      { version: "2.0.0", independentOwner: false, updatedAtMs: 10 },
    ]);
    expect(refs.every((ref) => ref.origin === "grove-introduced")).toBe(true);
  });

  it("scopes skill adoption to the owning agent workspace", () => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("grove-adoption-") };
    for (const agentId of ["first", "second"]) {
      const current = plan(agentId, `/tmp/${agentId}`);
      persistGroveInstallRecord(current, { env });
      persistClawPackageRef(
        current,
        {
          kind: "skill",
          source: "clawhub",
          ref: "triage",
          version: "1.0.0",
          integrity: packageIntegrity,
        },
        {
          env,
          relationship: "managed",
          origin: "grove-introduced",
          independentOwner: false,
        },
      );
    }

    expect(
      markClawPackageIndependentlyOwned(
        {
          kind: "skill",
          source: "clawhub",
          ref: "triage",
          version: "1.0.0",
          workspace: "/tmp/first",
        },
        { env },
      ),
    ).toBe(1);
    expect(readClawPackageRefs({ env, agentId: "first" })).toMatchObject([
      { origin: "grove-introduced", independentOwner: true },
    ]);
    expect(readClawPackageRefs({ env, agentId: "second" })).toMatchObject([
      { origin: "grove-introduced", independentOwner: false },
    ]);
  });

  it("retains global plugins and releases their Grove references", async () => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("grove-adoption-race-") };
    const current = plan("worker", "/tmp/worker");
    const install = persistGroveInstallRecord(current, { env });
    const ref = persistClawPackageRef(
      current,
      {
        kind: "plugin",
        source: "clawhub",
        ref: "@acme/audit",
        version: "1.0.0",
        integrity: packageIntegrity,
      },
      {
        env,
        relationship: "referenced",
        origin: "grove-introduced",
        independentOwner: false,
      },
    );
    const decisions = await planClawPackageRemovals(install, [ref], { env });

    const results = await applyClawPackageRemovals(decisions, { env });

    expect(results).toMatchObject({ packages: [{ action: "retained" }] });
    await expect(
      withClawPackageLifecycleLease(
        { kind: "plugin", source: "clawhub", ref: "@acme/audit" },
        async () => "direct operation admitted",
        { env },
      ),
    ).resolves.toBe("direct operation admitted");
  });

  it("serializes all skill mutations that share a workspace lockfile", async () => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("grove-skill-lease-") };
    let competingEntered = false;
    await withClawPackageLifecycleLease(
      { kind: "skill", source: "clawhub", ref: "triage", workspace: "/tmp/worker" },
      async () => {
        await expect(
          withClawPackageLifecycleLease(
            { kind: "skill", source: "clawhub", ref: "summarize", workspace: "/tmp/worker" },
            async () => {
              competingEntered = true;
            },
            { env },
          ),
        ).rejects.toMatchObject({ code: "BRANCH_STATE_LEASE_HELD" });
        await expect(
          withClawPackageLifecycleLease(
            { kind: "skill", source: "clawhub", ref: "triage", workspace: "/tmp/other" },
            async () => "other workspace admitted",
            { env },
          ),
        ).resolves.toBe("other workspace admitted");
      },
      { env },
    );
    expect(competingEntered).toBe(false);
  });

  it("leases a direct operation before the first Grove package reference exists", async () => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("grove-first-lease-") };
    const artifact = { kind: "plugin", source: "clawhub", ref: "@acme/audit" } as const;
    const entered = createDeferred();
    const finish = createDeferred();
    let competingEntered = false;
    const directOperation = withClawPackageLifecycleLease(
      artifact,
      async () => {
        entered.resolve();
        await finish.promise;
      },
      { env },
    );
    try {
      await awaitGateBeforeSettlement(
        entered.promise,
        directOperation,
        "Package operation settled before acquiring its lease",
      );
      await expect(
        withClawPackageLifecycleLease(
          artifact,
          async () => {
            competingEntered = true;
          },
          { env },
        ),
      ).rejects.toMatchObject({ code: "BRANCH_STATE_LEASE_HELD" });
      expect(competingEntered).toBe(false);
      await expect(
        withClawPackageLifecycleLease(
          { kind: "plugin", source: "clawhub", ref: "@acme/other" },
          async () => "other package admitted",
          { env },
        ),
      ).resolves.toBe("other package admitted");
    } finally {
      finish.resolve();
      await directOperation;
    }
    await expect(
      withClawPackageLifecycleLease(artifact, async () => "successor admitted", { env }),
    ).resolves.toBe("successor admitted");
  });

  it("refuses package mutation when lifecycle state is unavailable", async () => {
    const invalidDatabasePath = tempDirs.make("grove-invalid-db-path-");
    const artifact = { kind: "plugin", source: "clawhub", ref: "@acme/audit" } as const;
    let entered = false;
    await expect(
      withClawPackageLifecycleLease(
        artifact,
        async () => {
          entered = true;
        },
        { path: invalidDatabasePath },
      ),
    ).rejects.toThrow();
    expect(entered).toBe(false);
  });
});
