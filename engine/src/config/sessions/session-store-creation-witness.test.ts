import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { readDatabasePathIdentitySync } from "../../infra/sqlite-worker-identity.js";
import {
  createSqliteWorkerOperationAdmission,
  type SqliteWorkerAdmissionRequest,
} from "../../infra/sqlite-worker-operation-admission.js";
import { resolveBranchAgentSqlitePath } from "../../state/branch-agent-db.paths.js";
import { closeBranchAgentDatabasesAsync } from "../../state/branch-agent-db.js";
import type { AgentDatabaseRequestExecutionSource } from "../../state/branch-agent-execution-contract.js";
import { captureBranchAgentDatabaseExecution } from "../../state/branch-agent-execution.js";
import { closeBranchStateDatabaseAsync } from "../../state/branch-state-db.js";
import { LEASE_CONTENTION_RETRY_TIMEOUT_MS } from "../../state/branch-state-lease-heartbeat-shared.js";
import { loadSessionEntryForAdmission } from "./session-accessor.sqlite-entry-admission.js";
import { prepareSessionEntryMutationDatabases } from "./session-accessor.entry-mutation.js";
import { readSessionEntryInWorker } from "./session-entry-read-runtime.js";
import { SESSION_STORE_FIRST_OPEN_TIMEOUT_MS } from "./session-store-creation-witness.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    await closeBranchAgentDatabasesAsync();
    await closeBranchStateDatabaseAsync();
    cleanup();
  }),
);

function absentTrunk(agentId = "hazel") {
  const env = { BRANCH_STATE_DIR: fs.realpathSync(tempDirs.make("just-created-trunk-")) };
  const options = { agentId, env };
  return {
    ...options,
    path: resolveBranchAgentSqlitePath(options),
    scope: { agentId, env, sessionKey: `agent:${agentId}:main` },
  };
}

function source(
  beforeGrant: (request: SqliteWorkerAdmissionRequest) => void = () => {},
): AgentDatabaseRequestExecutionSource {
  return {
    assertCurrent() {},
    createAdmission(binding) {
      return () => ({
        nativeLocations: binding.nativeLocations,
        admission: createSqliteWorkerOperationAdmission((request, grant) => {
          beforeGrant(request);
          binding.authorize(request);
          if (!grant()) {
            throw new Error("Just-created Trunk fixture lost admission");
          }
        }, binding.attachment),
      });
    },
  };
}

async function concurrentFirstOpen(
  options: {
    agentId: string;
    env: NodeJS.ProcessEnv;
    path: string;
  },
  params: { prepareAfterMs?: number } = {},
) {
  const observed = readDatabasePathIdentitySync(options.path);
  expect(observed.key.startsWith("path:")).toBe(true);
  const sibling = captureBranchAgentDatabaseExecution(options, {
    expectedCreationIdentity: observed,
  });
  const prepareAfterMs = params.prepareAfterMs;
  const preparing =
    prepareAfterMs === undefined
      ? sibling.prepare(source())
      : (async () => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, prepareAfterMs);
          });
          await sibling.prepare(source());
        })();
  return {
    observed,
    preparing,
    async [Symbol.asyncDispose]() {
      await preparing.catch(() => undefined);
      await sibling.release();
    },
  };
}

it(
  "prepares sessions.create when this call is the first opener of the new Trunk store",
  // Cold Windows native open already exceeds the 2s lease budget; keep this above the 15s helper bound.
  { timeout: SESSION_STORE_FIRST_OPEN_TIMEOUT_MS + LEASE_CONTENTION_RETRY_TIMEOUT_MS },
  async () => {
    const options = absentTrunk("aspen");
    const started = performance.now();
    await using preparation = prepareSessionEntryMutationDatabases(
      [{ scope: options.scope, assertCurrent: () => {} }],
      Promise.resolve(),
    );
    await expect(preparation.preparations[0]).resolves.toEqual(
      expect.objectContaining({ execution: expect.anything() }),
    );
    expect(performance.now() - started).toBeLessThan(SESSION_STORE_FIRST_OPEN_TIMEOUT_MS);
  },
);

it("prepares sessions.create after a concurrent first-open reserves the new Trunk store", async () => {
  const options = absentTrunk();
  const started = performance.now();
  await using opener = await concurrentFirstOpen(options, {
    // Cold Windows native open outlasts the 2s lease-contention budget.
    prepareAfterMs: LEASE_CONTENTION_RETRY_TIMEOUT_MS + 500,
  });
  expect(opener.preparing).toBeInstanceOf(Promise);
  await using preparation = prepareSessionEntryMutationDatabases(
    [{ scope: options.scope, assertCurrent: () => {} }],
    Promise.resolve(),
  );
  await expect(preparation.preparations[0]).resolves.toEqual(
    expect.objectContaining({ execution: expect.anything() }),
  );
  expect(performance.now() - started).toBeLessThan(SESSION_STORE_FIRST_OPEN_TIMEOUT_MS);
});

it("admits the new Trunk conversation after a concurrent first-open reserves its store", async () => {
  const options = absentTrunk("juniper");
  await using opener = await concurrentFirstOpen(options);
  expect(opener.preparing).toBeInstanceOf(Promise);
  const admitted = await loadSessionEntryForAdmission(options.scope);
  try {
    expect(admitted.entry).toBeUndefined();
    admitted.databaseClaim.assertCurrent();
  } finally {
    await admitted.databaseClaim.release();
  }
});

it("reads the new Trunk conversation after a concurrent first-open reserves its store", async () => {
  const options = absentTrunk("cedar");
  await using opener = await concurrentFirstOpen(options);
  expect(opener.preparing).toBeInstanceOf(Promise);
  await expect(readSessionEntryInWorker(options.scope, () => {})).resolves.toBeUndefined();
});

it("still reports a real store identity failure for a just-created Trunk", async () => {
  const options = absentTrunk("willow");
  fs.mkdirSync(path.dirname(options.path), { recursive: true });
  fs.mkdirSync(options.path);
  await expect(loadSessionEntryForAdmission(options.scope)).rejects.toThrow(/regular file/);
});
