import fs from "node:fs";
import path from "node:path";
import type { Worker } from "node:worker_threads";
import { afterAll, expect, onTestFinished, test, vi } from "vitest";
import { createDeferred, withTestTimeout } from "../../test/helpers/promise.js";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import * as archiveWorker from "../config/sessions/session-accessor.sqlite-archive.js";
import { loadSessionEntryReadOnly } from "../config/sessions/session-accessor.sqlite-entry.js";
import { ensureSessionEntrySync } from "../config/sessions/session-accessor.sqlite-initial-entry.js";
import { runSqliteSessionReclamation } from "../config/sessions/session-accessor.sqlite-reclamation-run.js";
import { createLifecycleArtifactReclamationPlan } from "../config/sessions/session-accessor.sqlite-reclamation.js";
import { sessionChanges } from "../sessions/session-row-changes.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
} from "../state/branch-agent-db.js";
import {
  captureBranchStateDatabaseReadAdmission,
  registerBranchStateDatabaseAsyncResource,
  retainBranchStateDatabaseForIndependentRead,
} from "../state/branch-state-db-cache.js";
import {
  closeBranchStateDatabaseByPathAsync,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { startAwaitedReadMock } from "../state/branch-state-read-mock.test-support.js";
import * as stateReader from "../state/branch-state-read-worker.js";
import { setTestEnvValue } from "../test-utils/env.js";
import { createDirectChatContext } from "./server-chat.agent-events.test-helpers.js";
import { initializeSessionReadContext } from "./server-methods/sessions-read-cache.test-support.js";
import { getSessionRowProjection } from "./session-row-projection-access.js";
import { installGatewayTestHooks } from "./test-helpers.server.js";

const roots = useAutoCleanupTempDirTracker(afterAll);
let externalRoot: string | undefined;
let externalStatePath: string | undefined;
afterAll(async () => {
  if (externalRoot) {
    await closeBranchAgentDatabasesAsync(externalRoot);
    closeBranchAgentDatabasesForTest(externalRoot);
  }
  if (externalStatePath) {
    await closeBranchStateDatabaseByPathAsync(externalStatePath);
  }
});
installGatewayTestHooks();

test("joins a direct history projection's accepted read before retiring the Gateway home", async () => {
  const scope = { agentId: "main", sessionKey: "agent:main:fixture-history" };
  ensureSessionEntrySync(scope, { sessionId: "fixture-history", updatedAt: 1 });
  const shared = openBranchStateDatabase();
  const context = createDirectChatContext();
  await initializeSessionReadContext(context);
  const projection = getSessionRowProjection(context)!;
  await projection.ensureMaterialized();
  const entered = createDeferred();
  const release = createDeferred();
  const captureSource = stateReader.captureBranchStateReadSource;
  const reader = vi.spyOn(stateReader, "captureBranchStateReadSource").mockImplementation(() => {
    const source = captureSource();
    return {
      ...source,
      createTransport(command) {
        const transport = source.createTransport(command);
        if (command.type !== "acpSessions.metadata") {
          return transport;
        }
        return {
          ...transport,
          startRead(...args) {
            return startAwaitedReadMock(async () => {
              const reply = await transport.startRead(...args).result;
              entered.resolve();
              await release.promise;
              return reply;
            });
          },
        };
      },
    };
  });
  const dispose = projection.dispose;
  const disposing = vi.spyOn(projection, "dispose").mockImplementation(() => {
    dispose();
    release.resolve();
  });
  // Returning leaves a real native borrower pending until fixture disposal starts.
  // Always release it after a failed hook so the proof itself cannot leak custody.
  onTestFinished(async () => {
    release.resolve();
    try {
      await projection.ensureMaterialized();
      expect(shared.db.isOpen).toBe(false);
    } finally {
      reader.mockRestore();
      disposing.mockRestore();
    }
  });
  sessionChanges.emit(scope);
  await withTestTimeout(entered.promise, 5_000, "Projection did not retain its shared-state read");
  expect(shared.db.isOpen).toBe(true);
});

test("joins external-store workers before deleting their Gateway lease coordinator", async () => {
  externalRoot = fs.realpathSync(roots.make("gateway-external-store-"));
  const env = { BRANCH_STATE_DIR: process.env.BRANCH_STATE_DIR };
  const sharedStatePath = resolveBranchStateSqlitePath(env);
  const databaseOptions = {
    agentId: "main",
    env,
    path: path.join(externalRoot, "agent.sqlite"),
  };
  const scope = {
    agentId: "main",
    env,
    storePath: databaseOptions.path,
    sessionKey: "agent:main:fixture-reclamation",
  };
  ensureSessionEntrySync(scope, { sessionId: "fixture-reclamation", updatedAt: 1 });
  const plan = createLifecycleArtifactReclamationPlan({
    agentId: "main",
    databaseOptions,
    entries: [{ sessionKey: scope.sessionKey, expectedEntry: loadSessionEntryReadOnly(scope) }],
    materializedPlans: [],
  });
  // Seed handles belong to this external fixture; the next operation retains only its Worker.
  await closeBranchAgentDatabasesAsync(externalRoot);
  const workers: Worker[] = [];
  const create = archiveWorker.createSqliteTranscriptArchiveWorker;
  const spawned = vi
    .spyOn(archiveWorker, "createSqliteTranscriptArchiveWorker")
    .mockImplementation((data) => {
      const worker = create(data);
      workers.push(worker);
      return worker;
    });
  try {
    await expect(
      runSqliteSessionReclamation({ plan, forceInProcess: false }),
    ).resolves.toMatchObject({
      kind: "lifecycle-artifacts",
      value: { removedEntries: 1 },
    });
  } finally {
    spawned.mockRestore();
  }
  expect(workers).toHaveLength(1);
  expect(workers[0]?.threadId).toBeGreaterThan(0);
  expect(fs.existsSync(sharedStatePath)).toBe(true);
  const otherStateDir = path.join(externalRoot, "other-state");
  const otherState = openBranchStateDatabase({ env: { BRANCH_STATE_DIR: otherStateDir } });
  externalStatePath = otherState.path;
  const identity = captureBranchStateDatabaseReadAdmission(sharedStatePath).identity;
  const sharedState = openBranchStateDatabase({ env });
  let retained = retainBranchStateDatabaseForIndependentRead(sharedState.path);
  if (!retained) {
    throw new Error("Expected the fixture shared-state owner to be open");
  }
  const closedOwners: Array<string | undefined> = [];
  const unregister = registerBranchStateDatabaseAsyncResource({
    close: async (closedIdentity) => {
      closedOwners.push(closedIdentity?.key);
      if (closedIdentity?.key === identity.key) {
        retained?.release();
        retained = undefined;
      }
    },
  });
  setTestEnvValue("BRANCH_STATE_DIR", otherStateDir);
  onTestFinished(() => {
    try {
      expect(workers[0]?.threadId).toBe(-1);
      expect(fs.existsSync(sharedStatePath)).toBe(false);
      expect(closedOwners[0]).toBe(identity.key);
    } finally {
      retained?.release();
      unregister();
    }
  });
});
