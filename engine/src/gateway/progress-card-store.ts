import type { ProgressCard, ProgressCardStep } from "../../packages/gateway-protocol/src/index.js";
import { resolveUnsuffixedSqliteTargetFromSessionStorePath } from "../config/sessions/session-sqlite-target-paths.js";
import { prepareSqliteTargetFromSessionStorePath } from "../config/sessions/session-sqlite-target.js";
import { withSessionHistoryWorkerDatabase } from "../config/sessions/session-transcript-worker-runtime.js";
import { captureSessionTranscriptStorageEnvironment } from "../config/sessions/transcript-target-binding.js";
import { resolveStateDir } from "../config/state-dir.js";
import {
  readSessionProgressCard,
  writeSessionProgressCard,
} from "../session-cards/progress-card-store.js";
import { withBranchAgentDatabaseReadOnly } from "../state/branch-agent-db-readonly.js";
import {
  isIncognitoBranchAgentSqlitePath,
  resolveBranchAgentSqlitePath,
  runBranchAgentWriteTransaction,
  withBranchAgentDatabaseAsync,
} from "../state/branch-agent-db.js";
import { runBranchAgentWriteAdmission } from "../state/branch-agent-write-admission.js";
import { captureGatewaySessionStoreScope, resolveGatewaySessionDatabase } from "./board-store.js";

export type ProgressCardStore = {
  get(sessionKey: string, agentId?: string): Promise<ProgressCard | null>;
  put(
    sessionKey: string,
    input: {
      markdown?: string;
      steps?: ProgressCardStep[];
      expectedRevision?: number;
      // The storage owner checks authority inside its write transaction.
      assertCurrent?: () => void;
    },
    agentId?: string,
  ): Promise<{ card: ProgressCard | null }>;
};

export const progressCardStore: ProgressCardStore = {
  async get(sessionKey, agentId) {
    const env = captureSessionTranscriptStorageEnvironment(process.env);
    const scope = captureGatewaySessionStoreScope(sessionKey, agentId);
    const unsuffixed = resolveUnsuffixedSqliteTargetFromSessionStorePath(scope.storePath);
    if (isIncognitoBranchAgentSqlitePath(unsuffixed.path, { agentId: scope.agentId, env })) {
      const result = withBranchAgentDatabaseReadOnly(
        (database) => readSessionProgressCard(database.db, scope.sessionKey),
        { agentId: scope.agentId, path: unsuffixed.path, env },
      );
      return result.found ? result.value : null;
    }
    const target = await prepareSqliteTargetFromSessionStorePath(scope.storePath, {
      agentId: scope.agentId,
      env,
    });
    return await withSessionHistoryWorkerDatabase(
      { agentId: target.agentId ?? scope.agentId, path: target.path, env },
      (owner) => owner.readProgressCard({ sessionKey: scope.sessionKey, env }),
    );
  },
  async put(sessionKey, input, agentId) {
    const resolved = resolveGatewaySessionDatabase(sessionKey, agentId);
    const env = { ...process.env };
    env.BRANCH_STATE_DIR = resolveStateDir(env);
    const databaseOptions = {
      ...resolved,
      env,
      path: resolveBranchAgentSqlitePath({ ...resolved, env }),
    };
    const assertCurrent = () => {
      input.assertCurrent?.();
      const current = resolveGatewaySessionDatabase(sessionKey, agentId);
      if (
        current.agentId !== resolved.agentId ||
        current.path !== resolved.path ||
        current.sessionKey !== resolved.sessionKey
      ) {
        throw new Error("progress-card session changed; retry");
      }
    };
    assertCurrent();
    const result = await runBranchAgentWriteAdmission(
      databaseOptions,
      () =>
        withBranchAgentDatabaseAsync(
          databaseOptions,
          () =>
            runBranchAgentWriteTransaction(
              (database) => {
                assertCurrent();
                return writeSessionProgressCard(database.db, resolved.sessionKey, input);
              },
              databaseOptions,
              { operationLabel: "progress-card.put" },
            ),
          assertCurrent,
        ),
      true,
    );
    return "card" in result ? result : { card: null };
  },
};
