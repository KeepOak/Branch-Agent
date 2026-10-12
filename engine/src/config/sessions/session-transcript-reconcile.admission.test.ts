import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import * as sqlite from "../../infra/node-sqlite.js";
import * as admission from "../../infra/sqlite-worker-operation-admission.js";
import { withBranchAgentDatabaseReadOnly } from "../../state/branch-agent-db-readonly.js";
import {
  closeBranchAgentDatabaseByPath,
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "../../state/branch-agent-db.js";
import { clearBranchAgentIntegrityVerification } from "../../state/branch-quarantine-store.js";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import { persistSessionTranscriptTurn } from "./session-accessor.js";
import {
  reconcileSessionTranscriptIndexes,
  startSessionTranscriptIndexReconcile,
  waitForSessionTranscriptIndexReconcile,
  waitForSessionTranscriptIndexReconcilesInStateDir,
  waitForSessionTranscriptProjection,
} from "./session-transcript-reconcile.js";
import { useReconcileWorkerObserver } from "./session-transcript-reconcile.test-support.js";
import type { SessionTranscriptReconcileWorkerInput } from "./session-transcript-reconcile.worker.js";

vi.mock("node:worker_threads", async () =>
  (await import("./session-transcript-reconcile.test-support.js")).createObservedWorkerThreads(),
);

const observer = useReconcileWorkerObserver();
const roots: string[] = [];
const realOpen = sqlite.openNodeSqliteDatabase;

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots) {
    await waitForSessionTranscriptIndexReconcilesInStateDir(root);
  }
  await closeBranchAgentDatabasesAsync();
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "reconcile-admission-"));
  roots.push(root);
  vi.stubEnv("BRANCH_STATE_DIR", root);
  const options = { agentId: "main", env: { ...process.env, BRANCH_STATE_DIR: root } };
  const scope = { ...options, sessionId: "cold", sessionKey: "agent:main:cold" };
  await persistSessionTranscriptTurn(scope, {
    messages: [{ eventId: "seed", message: { role: "user", content: "cold admission fixture" } }],
    touchSessionEntry: false,
  });
  await waitForSessionTranscriptIndexReconcile(options);
  const database = openBranchAgentDatabase(options);
  database.db.prepare("UPDATE session_transcript_index_state SET needs_rebuild = 1").run();
  closeBranchAgentDatabaseByPath(database.path);
  return {
    root,
    options: { ...options, path: database.path },
    scope: { ...scope, storePath: database.path },
  };
}

it("waits for a cold projection without superseding its native integrity admission", async () => {
  const { root, options, scope } = await fixture();
  closeBranchAgentDatabasesForTest(root);
  clearBranchAgentIntegrityVerification(options.path, options.env);
  let parentChecks = 0;
  vi.spyOn(sqlite, "openNodeSqliteDatabase").mockImplementation((pathname, openOptions) => {
    const database = realOpen(pathname, openOptions);
    if (pathname === options.path && !openOptions?.readOnly) {
      const prepare = database.prepare.bind(database);
      database.prepare = (sql) => {
        const statement = prepare(sql);
        if (
          sql === "PRAGMA integrity_check;" ||
          sql === "PRAGMA integrity_check('sqlite_schema');"
        ) {
          const all = statement.all.bind(statement);
          statement.all = () => {
            parentChecks += 1;
            return all();
          };
        }
        return statement;
      };
    }
    return database;
  });
  const entered = createDeferred();
  const createAdmission = admission.createSqliteWorkerOperationAdmission;
  vi.spyOn(admission, "createSqliteWorkerOperationAdmission").mockImplementation(
    (admit, attachment) =>
      createAdmission((request, grant) => {
        if (request.stage === "open") {
          entered.resolve();
        }
        admit(request, grant);
      }, attachment),
  );
  startSessionTranscriptIndexReconcile(options);
  await entered.promise;
  await waitForSessionTranscriptProjection(scope);
  await waitForSessionTranscriptIndexReconcile(options);
  expect(parentChecks).toBe(0);
  expect(
    withBranchAgentDatabaseReadOnly(
      ({ db }) => db.prepare("SELECT needs_rebuild FROM session_transcript_index_state").get(),
      options,
    ),
  ).toEqual({ found: true, value: { needs_rebuild: 0 } });
});

it.each(["direct", "deferred"] as const)(
  "retains the operation environment before %s admission",
  async (mode) => {
    const { options } = await fixture();
    const nextRoot = fs.mkdtempSync(path.join(os.tmpdir(), "reconcile-next-owner-"));
    roots.push(nextRoot);
    const original = { ...options, env: { ...options.env } };
    const inputs: SessionTranscriptReconcileWorkerInput[] = [];
    observer.onTask = ({ input }) => inputs.push(input);
    const task = mode === "direct" ? reconcileSessionTranscriptIndexes(options) : undefined;
    if (mode === "deferred") {
      startSessionTranscriptIndexReconcile(options);
    }
    options.env.BRANCH_STATE_DIR = nextRoot;
    if (task) {
      await expect(task).resolves.toEqual({ reconciledSessions: 1 });
    } else {
      await waitForSessionTranscriptIndexReconcile(original);
    }
    expect(inputs).toContainEqual(
      expect.objectContaining({ mode: "disk", stateDir: original.env.BRANCH_STATE_DIR }),
    );
    expect(fs.readdirSync(nextRoot)).toEqual([]);
  },
);
