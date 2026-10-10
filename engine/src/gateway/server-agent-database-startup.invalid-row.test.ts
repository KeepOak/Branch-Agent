import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { withinTest } from "../../test/helpers/promise.js";
import { saveAuthProfileStore } from "../agents/auth-profiles.js";
import { readAgentDatabaseAdmissionRefusal } from "../state/agent-database-admission.js";
import { withAgentDatabaseStartupAdmission } from "../state/agent-database-startup.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import { assertBranchDatabasesReady } from "../state/branch-database-preflight.js";
import { listBranchSessionRowQuarantines } from "../state/branch-quarantine-store.js";
import { resolveQuarantineStorePath } from "../state/branch-state-db.paths.js";
import { closeStateDatabaseForTest } from "../test-utils/database-cleanup.js";
import { acquireTestPortBlock } from "../test-utils/port-claims.js";
import { loadGatewayTestConfig } from "./test-helpers.config-runtime.js";
import { testState } from "./test-helpers.runtime-state.js";
import { installGatewayTestHooks, startTestGatewayServer } from "./test-helpers.server.js";

installGatewayTestHooks();

it(
  "startup-inspection with invalid row: the gateway starts and the agent finishes preparation",
  { timeout: 300_000 },
  async ({ signal }) => {
    testState.agentsConfig = {
      ownership: "explicit",
      entries: { main: {}, worker: {} },
    };
    testState.agentConfig = {
      systemAgent: { agentId: "main" },
      authInheritance: { agentId: "main" },
    };
    vi.stubEnv("BRANCH_TEST_INVALID_ROW_SECRET", "synthetic-not-a-real-secret");
    const env = { ...process.env };
    const cfg = loadGatewayTestConfig();
    const paths = new Map<string, string>();
    for (const agentId of ["main", "worker"]) {
      const database = openBranchAgentDatabase({ agentId, env });
      paths.set(agentId, database.path);
      saveAuthProfileStore(
        {
          version: 1,
          profiles: {
            [`anthropic:${agentId}`]: {
              type: "api_key",
              provider: "anthropic",
              keyRef: { source: "env", provider: "default", id: "BRANCH_TEST_INVALID_ROW_SECRET" },
            },
          },
        },
        path.dirname(database.path),
      );
    }
    const worker = openBranchAgentDatabase({ agentId: "worker", env });
    worker.db
      .prepare(
        `INSERT INTO session_nodes (session_key, current_session_id, entry_json, entry_valid, updated_at)
         VALUES (?, ?, ?, 1, 1)`,
      )
      .run("agent:worker:healthy", "healthy", JSON.stringify({ sessionId: "healthy", updatedAt: 1 }));
    worker.db
      .prepare(
        `INSERT INTO session_nodes (session_key, current_session_id, entry_json, entry_valid, updated_at)
         VALUES (?, ?, ?, 1, 1)`,
      )
      .run("agent:worker:broken", "broken", JSON.stringify({ sessionId: "broken", updatedAt: 1 }));
    // One persisted row whose lineage column disagrees with its entry: invalid until repaired.
    worker.db.exec(
      "UPDATE session_nodes SET parent_session_key = 'agent:worker:elsewhere' WHERE session_key = 'agent:worker:broken'",
    );
    await closeBranchAgentDatabasesAsync();
    closeBranchAgentDatabasesForTest();
    await closeStateDatabaseForTest();
    // A version change defers the worker's inspection and preparation past the listener bind.
    const receipts = new DatabaseSync(resolveQuarantineStorePath(env));
    try {
      receipts
        .prepare("UPDATE agent_integrity_verifications SET app_version = ? WHERE path = ?")
        .run("2026.9.7", paths.get("worker")!);
    } finally {
      receipts.close();
    }
    let server: Awaited<ReturnType<typeof startTestGatewayServer>> | undefined;
    try {
      server = await withAgentDatabaseStartupAdmission(async () => {
        await assertBranchDatabasesReady({ env, operation: "gateway-startup", config: cfg });
        const portClaim = await acquireTestPortBlock({ offsets: [0, 1, 2, 3, 4] });
        return await startTestGatewayServer(portClaim, {
          bind: "loopback",
          auth: { mode: "none" },
        });
      });
      await server.startupSettled;
      await withinTest(
        vi.waitFor(
          () => {
            expect(readAgentDatabaseAdmissionRefusal("worker", { env })).toBeUndefined();
          },
          { timeout: 240_000, interval: 500 },
        ),
        signal,
      );
      // The bad row's original is recorded in the quarantine store, and the row is rewritten from
      // its own entry; the healthy row is untouched.
      expect(
        listBranchSessionRowQuarantines(paths.get("worker")!, { env }).map((entry) => [
          entry.sessionKey,
          entry.row.parent_session_key,
        ]),
      ).toEqual([["agent:worker:broken", "agent:worker:elsewhere"]]);
      const database = new DatabaseSync(paths.get("worker")!, { readOnly: true });
      try {
        expect(
          database
            .prepare("SELECT session_key, parent_session_key FROM session_nodes ORDER BY session_key")
            .all(),
        ).toEqual([
          { session_key: "agent:worker:broken", parent_session_key: null },
          { session_key: "agent:worker:healthy", parent_session_key: null },
        ]);
      } finally {
        database.close();
      }
    } finally {
      await server?.close();
    }
  },
);
