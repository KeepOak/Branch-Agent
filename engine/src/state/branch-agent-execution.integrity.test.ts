import fs from "node:fs";
import path from "node:path";
import type { Worker } from "node:worker_threads";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { createSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import {
  createBranchAgentDatabaseClaim,
  type BranchAgentDatabaseClaim,
} from "./branch-agent-db-identity.js";
import {
  claimBranchAgentDatabaseLease,
  releaseBranchAgentDatabaseLease,
} from "./branch-agent-db-lease.js";
import {
  closeCachedBranchAgentDatabase,
  retainAgentDatabase,
} from "./branch-agent-db-lifecycle.js";
import {
  getBranchAgentDatabaseValidation,
  invalidateBranchAgentDatabaseValidation,
} from "./branch-agent-db-validation-cache.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  closeBranchAgentDatabaseByPath,
  openBranchAgentDatabase,
  recordBranchAgentDatabaseOpenFailure,
} from "./branch-agent-db.js";
import { removeAgentIntegrityMetadataForTest } from "./branch-agent-db.test-support.js";
import type { AgentDatabaseRequestExecutionSource } from "./branch-agent-execution-contract.js";
import { createAgentDatabaseNativeGeneration } from "./branch-agent-execution-native.js";
import { captureBranchAgentDatabaseExecution } from "./branch-agent-execution.js";
import * as verification from "./branch-database-verify.js";
import {
  clearBranchAgentIntegrityVerification,
  readBranchAgentIntegrityVerification,
} from "./branch-quarantine-store.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "./branch-state-db.js";
import {
  resolveBranchStateSqlitePath,
  resolveQuarantineStorePath,
} from "./branch-state-db.paths.js";
import { captureBranchStateWorkerContext } from "./branch-state-worker-context.js";
import * as stateWorkerStore from "./branch-state-worker-store.js";

const counter = vi.hoisted(() => ({
  path: "",
  checks: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2),
}));
vi.mock("../infra/worker-cpu.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../infra/worker-cpu.js")>();
  const preload = `
    import { DatabaseSync } from "node:sqlite";
    import { workerData } from "node:worker_threads";
    const prepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function(sql) {
      const statement = prepare.call(this, sql);
      const match = /^PRAGMA (integrity_check|foreign_key_check)(?:[(]'sqlite_schema'[)])?;?$/i.exec(sql.trim());
      if (this.location() === workerData.testIntegrityPath && match) {
        for (const method of ["all", "get", "iterate", "run"]) {
          const execute = statement[method].bind(statement);
          statement[method] = (...args) => {
            Atomics.add(new Int32Array(workerData.testIntegrityChecks),
              match[1].toLowerCase() === "integrity_check" ? 0 : 1, 1);
            return execute(...args);
          };
        }
      }
      return statement;
    };
  `;
  return {
    ...actual,
    createCpuTrackedWorker(
      filename: string | URL,
      options: ConstructorParameters<typeof Worker>[1],
    ) {
      return actual.createCpuTrackedWorker(filename, {
        ...options,
        execArgv: [
          ...(options?.execArgv ?? []),
          "--import",
          `data:text/javascript,${encodeURIComponent(preload)}`,
        ],
        workerData: {
          ...options?.workerData,
          testIntegrityPath: counter.path,
          testIntegrityChecks: counter.checks,
        },
      });
    },
  };
});

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    await closeBranchAgentDatabasesAsync();
    await closeBranchStateDatabaseAsync();
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    cleanup();
  }),
);

it.each(["confirmed close", "native exit"] as const)(
  "uses native close evidence before recovering an agent lease (%s)",
  async (outcome) => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("agent-native-close-") };
    const database = openBranchAgentDatabase({ agentId: "main", env });
    const shared = openBranchStateDatabase({ env });
    const leases = () =>
      shared.db
        .prepare("SELECT lease_id FROM agent_database_leases WHERE path = ? ORDER BY lease_id")
        .all(database.path);
    const hostLeases = leases();
    expect(hostLeases).toHaveLength(1);
    const context = captureBranchStateWorkerContext({ env });
    const assertCurrent = () => context.admission.assertCurrent();
    const source: AgentDatabaseRequestExecutionSource = {
      assertCurrent,
      createAdmission: (binding) => () => ({
        nativeLocations: binding.nativeLocations,
        admission: createSqliteWorkerOperationAdmission((request, grant) => {
          binding.authorize(request);
          assertCurrent();
          if (!grant()) {
            throw new Error("Native close fixture lost admission");
          }
        }, binding.attachment),
      }),
    };
    const generation = createAgentDatabaseNativeGeneration(
      database.agentId,
      database.path,
      context,
      assertCurrent,
      assertCurrent,
      undefined,
      () => {},
    );
    const workers: Worker[] = [];
    const observeWorker = (worker: Worker) => workers.push(worker);
    const cleanup = vi.spyOn(stateWorkerStore, "openBranchStateWorkerCleanupStore");
    process.on("worker", observeWorker);
    try {
      await expect(generation.run(source, async () => "opened")).resolves.toBe("opened");
      expect(leases()).toHaveLength(2);
      process.off("worker", observeWorker);
      if (outcome === "native exit") {
        expect(workers.length).toBeGreaterThan(0);
        await Promise.all(workers.map((worker) => worker.terminate()));
        expect(leases()).toHaveLength(2);
      }
      await generation.close();
      expect(leases()).toEqual(hostLeases);
      expect(cleanup).toHaveBeenCalledTimes(outcome === "confirmed close" ? 0 : 1);
    } finally {
      process.off("worker", observeWorker);
      try {
        await generation.close();
      } finally {
        cleanup.mockRestore();
      }
    }
  },
);

it.each(["settled", "pending"] as const)(
  "prepares missing storage after an existing-only miss (%s)",
  async (timing) => {
    const env = { BRANCH_STATE_DIR: fs.realpathSync(tempDirs.make("agent-prepare-missing-")) };
    const execution = captureBranchAgentDatabaseExecution({ agentId: "main", env });
    const source: AgentDatabaseRequestExecutionSource = {
      assertCurrent: () => execution.assertCurrent(),
      createAdmission(binding) {
        return () => ({
          nativeLocations: binding.nativeLocations,
          admission: createSqliteWorkerOperationAdmission((request, grant) => {
            binding.authorize(request);
            execution.assertCurrent();
            if (!grant()) {
              throw new Error("Missing database fixture lost admission");
            }
          }, binding.attachment),
        });
      },
    };
    try {
      const missing = execution.runExisting(source, async () => "unexpected");
      if (timing === "settled") {
        expect(await missing).toBeUndefined();
      }
      const preparing = execution.prepare(source);
      expect(await missing).toBeUndefined();
      await preparing;
      expect(fs.existsSync(execution.path)).toBe(true);
      expect(await execution.runExisting(source, async () => "opened")).toBe("opened");
    } finally {
      await execution.release();
    }
  },
);

it("opens an unconfigured external store without reconstructing unknown deletion history", async () => {
  const env = { BRANCH_STATE_DIR: tempDirs.make("agent-worker-missing-history-") };
  const external = tempDirs.make("agent-worker-external-history-");
  const pathname = path.join(external, "retained.sqlite");
  const retained = openBranchAgentDatabase({
    agentId: "main",
    path: pathname,
    env: { BRANCH_STATE_DIR: tempDirs.make("agent-worker-fixture-owner-") },
  });
  retained.db.exec("INSERT INTO auth_profile_state VALUES ('preserved', '{\"ok\":true}', 1)");
  closeBranchAgentDatabaseByPath(pathname);
  const bytes = fs.readFileSync(pathname);
  const context = captureBranchStateWorkerContext({ env });
  const assertCurrent = () => context.admission.assertCurrent();
  const source: AgentDatabaseRequestExecutionSource = {
    assertCurrent,
    createAdmission: (binding) => () => ({
      nativeLocations: binding.nativeLocations,
      admission: createSqliteWorkerOperationAdmission((request, grant) => {
        binding.authorize(request);
        assertCurrent();
        if (!grant()) {
          throw new Error("External store fixture lost its admission");
        }
      }, binding.attachment),
    }),
  };
  const generation = createAgentDatabaseNativeGeneration(
    "main",
    pathname,
    context,
    assertCurrent,
    assertCurrent,
    undefined,
    () => {},
  );
  const opening = await Promise.allSettled([generation.run(source, async () => "opened")]);
  const closing = await Promise.allSettled([generation.close()]);
  expect(opening).toEqual([{ status: "fulfilled", value: "opened" }]);
  expect(closing).toEqual([{ status: "fulfilled", value: undefined }]);
  expect(fs.readFileSync(pathname)).toEqual(bytes);
  expect(fs.readdirSync(external)).toEqual(["retained.sqlite"]);
  const shared = openNodeSqliteDatabase(resolveBranchStateSqlitePath(env), { readOnly: true });
  try {
    expect(
      shared.prepare("SELECT name FROM sqlite_schema WHERE name = 'agent_deletion_journal'").get(),
    ).toBeUndefined();
  } finally {
    shared.close();
  }
});

it.each([
  "verified",
  "two-leases",
  "two-leases-missing-metadata",
  "two-leases-stale",
  "two-leases-unknown-owner",
  "two-leases-unclean",
  "prepared-existing",
  "invalidated",
  "failed",
  "revoked-before-grant",
  "missing-metadata",
  "version-mismatch",
  "closed-host",
  "closed-host-blocked",
  "closed-host-blocked-last",
  "closed-host-revoked",
  "closed-host-replaced",
] as const)("native execution borrows only current host integrity proof (%s)", async (proof) => {
  const env = { BRANCH_STATE_DIR: fs.realpathSync(tempDirs.make("agent-native-integrity-")) };
  const database = openBranchAgentDatabase({ agentId: "main", env });
  expect(getBranchAgentDatabaseValidation(database)).toBeDefined();
  counter.path = database.path;
  counter.checks = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
  const context = captureBranchStateWorkerContext({ env });
  const closedHost = proof.startsWith("closed-host");
  const siblingLease =
    (closedHost && proof !== "closed-host-blocked-last") || proof.startsWith("two-leases")
      ? claimBranchAgentDatabaseLease({ agentId: database.agentId, path: database.path, env })
      : undefined;
  if (proof === "two-leases") {
    expect(readBranchAgentIntegrityVerification(database.path, env)?.clean_close).toBe(0);
  }
  if (proof === "two-leases-missing-metadata") {
    removeAgentIntegrityMetadataForTest(env);
  }
  if (proof === "two-leases-stale" || proof === "two-leases-unknown-owner") {
    openBranchStateDatabase({ env })
      .db.prepare("UPDATE agent_database_leases SET owner_start_time = ? WHERE lease_id = ?")
      .run(proof === "two-leases-stale" ? -1 : null, siblingLease!);
  } else if (proof === "two-leases-unclean") {
    releaseBranchAgentDatabaseLease(siblingLease!, { env });
  }
  const claim: BranchAgentDatabaseClaim | undefined = closedHost
    ? undefined
    : createBranchAgentDatabaseClaim(database, retainAgentDatabase(database.db));
  if (proof === "closed-host-blocked" || proof === "closed-host-blocked-last") {
    database.db.exec("INSERT INTO auth_profile_state VALUES ('checkpoint', '{}', 1)");
    const reader = openNodeSqliteDatabase(database.path, { readOnly: true });
    try {
      reader.exec("BEGIN");
      reader
        .prepare("SELECT state_json FROM auth_profile_state WHERE state_key='checkpoint'")
        .get();
      database.db.exec("UPDATE auth_profile_state SET updated_at=2 WHERE state_key='checkpoint'");
      closeCachedBranchAgentDatabase(database, { eviction: true });
      expect(database.walMaintenance.health?.state).toBe("blocked");
      expect(database.db.isOpen).toBe(false);
      expect(readBranchAgentIntegrityVerification(database.path, env)?.clean_close).toBe(0);
    } finally {
      reader.close();
    }
  } else if (closedHost) {
    closeBranchAgentDatabaseByPath(database.path);
  }
  const assertCurrent = () => {
    claim?.assertCurrent();
    context.admission.assertCurrent();
  };
  let revokedBeforeGrant = false;
  const source: AgentDatabaseRequestExecutionSource = {
    assertCurrent,
    createAdmission(binding) {
      return () => ({
        nativeLocations: binding.nativeLocations,
        admission: createSqliteWorkerOperationAdmission((request, grant) => {
          binding.authorize(request);
          assertCurrent();
          if (
            proof === "revoked-before-grant" &&
            request.stage === "prepare" &&
            typeof request.facts === "object" &&
            request.facts !== null &&
            "kind" in request.facts &&
            request.facts.kind === "shared-owner"
          ) {
            // Revoke the already-sent proof while the native opener still awaits its grant.
            invalidateBranchAgentDatabaseValidation(database.path);
            revokedBeforeGrant = true;
          }
          if (!grant()) {
            throw new Error("Native integrity fixture lost its retained admission");
          }
        }, binding.attachment),
      });
    },
  };
  const generation = createAgentDatabaseNativeGeneration(
    database.agentId,
    database.path,
    context,
    assertCurrent,
    assertCurrent,
    undefined,
    () => {},
  );
  if (proof === "invalidated" || proof === "closed-host-revoked") {
    invalidateBranchAgentDatabaseValidation(database.path);
  } else if (proof === "closed-host-replaced") {
    fs.copyFileSync(database.path, `${database.path}.replacement`);
    fs.renameSync(`${database.path}.replacement`, database.path);
  } else if (proof === "failed") {
    recordBranchAgentDatabaseOpenFailure(database.path, new Error("Synthetic host failure"));
  } else if (proof === "missing-metadata") {
    clearBranchAgentIntegrityVerification(database.path, env);
  } else if (proof === "version-mismatch") {
    const store = openNodeSqliteDatabase(resolveQuarantineStorePath(env));
    try {
      store.exec("UPDATE agent_integrity_verifications SET app_version='previous-release'");
    } finally {
      store.close();
    }
  }
  const quickCheck = vi.spyOn(verification, "requestBranchAgentDatabaseQuickCheck");
  try {
    if (proof === "failed") {
      await expect(generation.run(source, async () => "opened")).rejects.toThrow(
        "Branch Agent agent database claim is no longer current",
      );
      expect(getBranchAgentDatabaseValidation(database)).toBeUndefined();
      expect(Array.from(new Int32Array(counter.checks))).toEqual([0, 0]);
      return;
    }
    await expect(
      generation.run(source, async () => "opened", undefined, proof === "prepared-existing"),
    ).resolves.toBe("opened");
    expect(quickCheck).not.toHaveBeenCalled();
    expect(Array.from(new Int32Array(counter.checks))).toEqual(
      proof === "verified" ||
        proof === "prepared-existing" ||
        proof === "closed-host" ||
        proof === "closed-host-blocked" ||
        proof === "closed-host-blocked-last" ||
        proof === "two-leases" ||
        proof === "two-leases-missing-metadata" ||
        proof === "version-mismatch"
        ? [0, 0]
        : [1, 1],
    );
    expect(revokedBeforeGrant).toBe(proof === "revoked-before-grant");
  } finally {
    quickCheck.mockRestore();
    try {
      await generation.close();
    } finally {
      claim?.release();
      if (siblingLease) {
        releaseBranchAgentDatabaseLease(siblingLease, { env }, "read-only");
      }
    }
  }
  if (proof === "closed-host-blocked-last") {
    expect(readBranchAgentIntegrityVerification(database.path, env)?.clean_close).toBe(1);
  }
});
