import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll } from "vitest";
import { resetConfigRuntimeState } from "../../src/config/runtime-snapshot.js";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../../src/infra/kysely-sync.js";
import { clearPluginStateStoreForTests } from "../../src/plugin-state/plugin-state-store.test-helpers.js";
import { AsyncWorkScope } from "../../src/shared/async-work-scope.js";
import type { DB as AgentDatabase } from "../../src/state/branch-agent-db.generated.js";
import { runBranchAgentWriteTransaction } from "../../src/state/branch-agent-db.js";
import type { DB as StateDatabase } from "../../src/state/branch-state-db.generated.js";
import { runBranchStateWriteTransaction } from "../../src/state/branch-state-db.js";
import { captureEnv } from "../../src/test-utils/env.js";
import {
  createBranchTestState,
  withBranchTestState,
  type BranchTestState,
} from "../../src/test-utils/branch-test-state.js";
import { drainSessionStateForTest } from "../../src/test-utils/session-state-cleanup.js";

/** Keep admitted databases warm; native transports and registries remain case-owned. */
export function useCanonicalDescendantState(env: Record<string, string>) {
  let shared: BranchTestState;
  let sequence = 0;
  beforeAll(async () => {
    shared = await createBranchTestState({
      label: "canonical-descendant",
      env,
      applyEnv: false,
    });
  });
  afterAll(async () => {
    shared?.applyEnv();
    await shared?.cleanup();
  });

  return async (run: (state: BranchTestState) => Promise<void>, isolated = false) => {
    if (isolated) {
      // Worker-claim cases also own placement/environment rows and projections.
      await withBranchTestState({ label: "canonical-descendant-worker", env }, run);
      return;
    }
    const previousEnv = captureEnv(Object.keys(shared.envVars));
    shared.applyEnv();
    const work = new AsyncWorkScope();
    const workspaceDir = path.join(shared.workspaceDir, `case-${++sequence}`);
    try {
      await fs.mkdir(workspaceDir, { recursive: true });
      await work.track(() => run({ ...shared, workspaceDir }));
    } finally {
      try {
        await work.drain();
        await drainSessionStateForTest({ stateDir: shared.stateDir, rootPath: shared.root });
        // Cascades remove windows, transcript rows, and their indexes without
        // replacing admitted database handles or terminating their workers.
        runBranchAgentWriteTransaction(
          ({ db }) => {
            const kysely = getNodeSqliteKysely<AgentDatabase>(db);
            // FTS identities have no foreign key; their delete trigger clears search content.
            executeSqliteQuerySync(db, kysely.deleteFrom("session_transcript_fts_rows"));
            executeSqliteQuerySync(db, kysely.deleteFrom("session_nodes"));
          },
          { agentId: "main" },
        );
        runBranchStateWriteTransaction(({ db }) => {
          const kysely = getNodeSqliteKysely<StateDatabase>(db);
          for (const table of [
            "session_upstream_links",
            "session_watch_cursors",
            "session_state_events",
            "session_state_heads",
          ] as const) {
            executeSqliteQuerySync(db, kysely.deleteFrom(table));
          }
        });
        clearPluginStateStoreForTests();
        await fs.rm(workspaceDir, { recursive: true, force: true });
      } finally {
        previousEnv.restore();
        resetConfigRuntimeState();
      }
    }
  };
}
