import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { withinTest } from "../../test/helpers/promise.js";
import { saveAuthProfileStore } from "../agents/auth-profiles.js";
import { registerRuntimeAuthProfileStoreMutationListener } from "../agents/auth-profiles/runtime-snapshots.js";
import { sessionChanges } from "../sessions/session-row-changes.js";
import { readAgentDatabaseAdmissionRefusal } from "../state/agent-database-admission.js";
import { withAgentDatabaseStartupAdmission } from "../state/agent-database-startup.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import { assertBranchDatabasesReady } from "../state/branch-database-preflight.js";
import { resolveQuarantineStorePath } from "../state/branch-state-db.paths.js";
import { closeStateDatabaseForTest } from "../test-utils/database-cleanup.js";
import { acquireTestPortBlock } from "../test-utils/port-claims.js";
import { loadGatewayTestConfig } from "./test-helpers.config-runtime.js";
import { testState } from "./test-helpers.runtime-state.js";
import { installGatewayTestHooks, startTestGatewayServer } from "./test-helpers.server.js";

installGatewayTestHooks();

it(
  "prepares three deferred agents with inherited auth after a restart without staling ready agents",
  { timeout: 300_000 },
  async ({ signal }) => {
    const deferred = ["worker-a", "worker-b", "worker-c"];
    testState.agentsConfig = {
      ownership: "explicit",
      entries: Object.fromEntries(["main", ...deferred].map((id) => [id, {}])),
    };
    testState.agentConfig = {
      systemAgent: { agentId: "main" },
      authInheritance: { agentId: "main" },
    };
    vi.stubEnv("BRANCH_TEST_MULTI_AGENT_SECRET", "synthetic-not-a-real-secret");
    const env = { ...process.env };
    const cfg = loadGatewayTestConfig();
    const paths = new Map<string, string>();
    for (const agentId of ["main", ...deferred]) {
      const database = openBranchAgentDatabase({ agentId, env });
      paths.set(agentId, database.path);
      saveAuthProfileStore(
        {
          version: 1,
          profiles: {
            [`anthropic:${agentId}`]: {
              type: "api_key",
              provider: "anthropic",
              keyRef: { source: "env", provider: "default", id: "BRANCH_TEST_MULTI_AGENT_SECRET" },
            },
          },
        },
        path.dirname(database.path),
      );
    }
    await closeBranchAgentDatabasesAsync();
    closeBranchAgentDatabasesForTest();
    await closeStateDatabaseForTest();
    // A version change defers each agent's inspection and preparation past the listener bind.
    const receipts = new DatabaseSync(resolveQuarantineStorePath(env));
    try {
      for (const agentId of deferred) {
        receipts
          .prepare("UPDATE agent_integrity_verifications SET app_version = ? WHERE path = ?")
          .run("2026.9.7", paths.get(agentId)!);
      }
    } finally {
      receipts.close();
    }
    // A global auth mutation stales every published agent, which turns each later preparation
    // into a rebuild of all ready agents (P38). Once one deferred agent is ready, none may occur.
    let anyReady = false;
    const globalMutationsAfterReady: unknown[] = [];
    const unregister = registerRuntimeAuthProfileStoreMutationListener((event) => {
      if (anyReady && event.affectsInheritedStores) {
        globalMutationsAfterReady.push(event);
      }
    });
    const unsubscribe = sessionChanges.subscribe((change) => {
      const agentId =
        "all" in change && typeof change.scope === "object" && change.scope.topology
          ? change.scope.agentId
          : undefined;
      if (agentId && deferred.includes(agentId)) {
        anyReady = true;
      }
    });
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
            for (const agentId of deferred) {
              expect(readAgentDatabaseAdmissionRefusal(agentId, { env })).toBeUndefined();
            }
          },
          { timeout: 240_000, interval: 500 },
        ),
        signal,
      );
      // Each later preparation stays scoped to its own agent, like the first one.
      expect(globalMutationsAfterReady).toEqual([]);
    } finally {
      unsubscribe();
      unregister();
      await server?.close();
    }
  },
);
