import assert from "node:assert/strict";
import { once } from "node:events";
import { isMainThread, MessageChannel } from "node:worker_threads";
import { onInternalDiagnosticEvent } from "../infra/diagnostic-events.js";
import { createSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import { setLoggerOverride } from "../logging/logger.js";
import { drainGlobalSingletonLifecycleState } from "../shared/global-singleton.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import {
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "./branch-agent-db.js";
import type { AgentDatabaseRequestExecutionSource } from "./branch-agent-execution-contract.js";
import { createAgentDatabaseNativeGeneration } from "./branch-agent-execution-native.js";
import { startBranchDatabaseIntegrityVerifier } from "./branch-database-verify.js";
import { readBranchAgentIntegrityVerification } from "./branch-quarantine-store.js";
import { captureBranchStateWorkerContext } from "./branch-state-worker-context.js";

assert.equal(isMainThread, true, "Broker admission must run on the real host thread");
await withBranchTestState(
  { label: "database-verifier-worker-relay" },
  async ({ env, statePath }) => {
    setLoggerOverride({ level: "info", file: statePath("verify.log"), consoleLevel: "silent" });
    const agent = openBranchAgentDatabase({ agentId: "worker-1", env });
    // Simulate a restart: retain the clean receipt without the initializer's runtime proof.
    closeBranchAgentDatabasesForTest();
    const before = readBranchAgentIntegrityVerification(agent.path, env);
    assert.equal(before?.clean_close, 1);
    assert.ok(before);

    // The real Gateway keeps a listener alive; its verifier timer is deliberately unref'd.
    const { port1, port2 } = new MessageChannel();
    const verified = once(port1, "message");
    const unsubscribe = onInternalDiagnosticEvent(
      (event) => {
        if (
          event.type === "log.record" &&
          event.attributes?.subsystem === "state/database-verify" &&
          event.message === "database integrity verification passed" &&
          event.attributes?.path === agent.path
        ) {
          port2.postMessage(null);
        }
      },
      { include: ["log.record"] },
    );
    const verifier = startBranchDatabaseIntegrityVerifier({ env });
    const context = captureBranchStateWorkerContext({ env });
    const generation = createAgentDatabaseNativeGeneration(
      agent.agentId,
      agent.path,
      context,
      context.admission.assertCurrent,
      context.admission.assertCurrent,
      undefined,
      () => {},
    );
    const source: AgentDatabaseRequestExecutionSource = {
      assertCurrent: context.admission.assertCurrent,
      createAdmission(binding) {
        return () => ({
          nativeLocations: binding.nativeLocations,
          admission: createSqliteWorkerOperationAdmission((request, grant) => {
            binding.authorize(request);
            context.admission.assertCurrent();
            assert.ok(grant(), "Synthetic database admission expired");
          }, binding.attachment),
        });
      },
    };
    try {
      await generation.run(source, (scope) =>
        scope.execute({ type: "database.prepareWrite", input: undefined }),
      );
      await verified;
      assert.deepEqual(
        { ...readBranchAgentIntegrityVerification(agent.path, env) },
        {
          ...before,
          clean_close: 0,
        },
      );
    } finally {
      await verifier.stop();
      await generation.close();
      await drainGlobalSingletonLifecycleState();
      unsubscribe();
      port1.close();
      port2.close();
      setLoggerOverride(null);
    }
  },
);
