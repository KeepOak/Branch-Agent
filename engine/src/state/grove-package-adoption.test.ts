import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runNodeScript } from "../../test/helpers/run-node-script.js";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { applyClawPackageRemovals, planClawPackageRemovals } from "../groves/package-remove.js";
import {
  persistGroveInstallRecord,
  persistClawPackageRef,
  readClawPackageRefs,
} from "../groves/provenance.js";
import type { GroveAddPlan } from "../groves/types.js";
import { resolveRuntimeWorkerArgv, resolveRuntimeWorkerUrl } from "../infra/runtime-worker-url.js";
import { createNodeEvalArgs, resolveTestNodeExecPath } from "../test-utils/node-process.js";
import { markClawPackageIndependentlyOwned } from "./grove-package-adoption.js";
import { acquireClawPackageLifecycleLease } from "./grove-package-lifecycle-lease.js";
import { stateNativeProcessEntrypoints } from "./native-process-runtime.test-support.js";
import { closeBranchStateDatabaseForTest } from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(() => {
    closeBranchStateDatabaseForTest();
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
    const directLease = acquireClawPackageLifecycleLease(
      { kind: "plugin", source: "clawhub", ref: "@acme/audit" },
      { env, required: true },
    );
    expect(directLease).not.toBeNull();
    directLease?.release();
  });

  it("serializes all skill mutations that share a workspace lockfile", () => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("grove-skill-lease-") };
    const first = acquireClawPackageLifecycleLease(
      { kind: "skill", source: "clawhub", ref: "triage", workspace: "/tmp/worker" },
      { env, required: true },
    );
    expect(() =>
      acquireClawPackageLifecycleLease(
        { kind: "skill", source: "clawhub", ref: "summarize", workspace: "/tmp/worker" },
        { env, required: true },
      ),
    ).toThrow("being changed by another Branch Agent lifecycle");
    const otherWorkspace = acquireClawPackageLifecycleLease(
      { kind: "skill", source: "clawhub", ref: "triage", workspace: "/tmp/other" },
      { env, required: true },
    );
    expect(otherWorkspace).not.toBeNull();
    otherWorkspace?.release();
    first?.release();
  });

  it("leases a direct operation before the first Grove package reference exists", () => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("grove-first-lease-") };
    const directLease = acquireClawPackageLifecycleLease(
      { kind: "plugin", source: "clawhub", ref: "@acme/audit" },
      { env },
    );
    expect(directLease).not.toBeNull();
    expect(() =>
      acquireClawPackageLifecycleLease(
        { kind: "plugin", source: "clawhub", ref: "@acme/audit" },
        { env },
      ),
    ).toThrow("being changed by another Branch Agent lifecycle");
    expect(() =>
      acquireClawPackageLifecycleLease(
        { kind: "plugin", source: "clawhub", ref: "@acme/audit" },
        { env, required: true },
      ),
    ).toThrow("being changed by another Branch Agent lifecycle");
    directLease?.release();
  });

  it("renews live package leases and fences expired or replaced owners", () => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("grove-lease-owner-") };
    const artifact = { kind: "plugin", source: "clawhub", ref: "@acme/audit" } as const;
    const acquire = (owner: string, nowMs: number) =>
      acquireClawPackageLifecycleLease(artifact, { env, owner, nowMs, required: true })!;
    const first = acquire("first", 1_000);
    first.heartbeat(2_000);
    expect(() => acquire("blocked", 301_000)).toThrow(
      "being changed by another Branch Agent lifecycle",
    );
    expect(() => first.heartbeat(302_000)).toThrow(
      "Package lifecycle lease was lost for @acme/audit.",
    );

    const replacement = acquire("replacement", 302_000);
    expect(() => first.heartbeat(302_001)).toThrow(
      "Package lifecycle lease was lost for @acme/audit.",
    );
    first.release();
    expect(() => acquire("still-blocked", 302_001)).toThrow(
      "being changed by another Branch Agent lifecycle",
    );
    replacement.heartbeat(302_001);
    replacement.release();
    acquire("next", 302_002).release();
  });

  it("releases a package lease when process exit bypasses async cleanup", async () => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("grove-exit-lease-") };
    const artifact = { kind: "plugin", source: "clawhub", ref: "@acme/audit" } as const;
    const moduleUrl = resolveRuntimeWorkerUrl(
      stateNativeProcessEntrypoints.clawPackageLifecycleLease,
    );
    const result = await runNodeScript(
      [
        ...resolveRuntimeWorkerArgv(moduleUrl, resolveTestNodeExecPath()).slice(0, -1),
        ...createNodeEvalArgs(
          `
          import { withClawPackageLifecycleLease } from ${JSON.stringify(moduleUrl.href)};
          await withClawPackageLifecycleLease(
            ${JSON.stringify(artifact)},
            async () => { process.exit(23); },
            { required: true },
          );
        `,
        ),
      ],
      { ...process.env, ...env },
      60_000,
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(23);
    const nextLease = acquireClawPackageLifecycleLease(artifact, { env, required: true });
    expect(nextLease).not.toBeNull();
    nextLease?.release();
  });

  it("fails open only for optional direct leases when lifecycle state is unavailable", () => {
    const invalidDatabasePath = tempDirs.make("grove-invalid-db-path-");
    const artifact = { kind: "plugin", source: "clawhub", ref: "@acme/audit" } as const;
    expect(acquireClawPackageLifecycleLease(artifact, { path: invalidDatabasePath })).toBeNull();
    expect(() =>
      acquireClawPackageLifecycleLease(artifact, {
        path: invalidDatabasePath,
        required: true,
      }),
    ).toThrow();
  });
});
