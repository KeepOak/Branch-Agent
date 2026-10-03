import { assertSessionEntryCurrentAdmission } from "../config/sessions/session-entry-current-admission.js";
import type { SessionEntryCurrentCheck } from "../config/sessions/session-entry-current.types.js";
import { createSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import {
  executeBranchStateWorker,
  runBranchStateWorkerOperation,
} from "../state/branch-state-worker-store.js";
import type { SessionUpstreamLink } from "./session-upstream-links.kernel.js";
import type { SessionUpstreamSettlement } from "./session-upstream-links.worker-contract.js";

export function isSessionUpstreamLinkCurrent(
  expected: SessionUpstreamLink,
  options: BranchStateDatabaseOptions,
): Promise<boolean> {
  return executeBranchStateWorker(captureBranchStateWorkerContext(options), {
    type: "sessionUpstream.current",
    input: expected,
  });
}

export function settleSessionUpstreamLink(
  expected: SessionUpstreamLink,
  settlement: SessionUpstreamSettlement,
  options: BranchStateDatabaseOptions & {
    assertCurrent: () => void;
    sessionEntryCurrent?: SessionEntryCurrentCheck;
  },
): Promise<boolean> {
  const context = captureBranchStateWorkerContext(options);
  const { assertCurrent, sessionEntryCurrent } = options;
  const input = structuredClone({
    expected,
    settlement,
    sessionEntryCurrentSource: sessionEntryCurrent?.source,
  });
  return runBranchStateWorkerOperation(
    context,
    (scope) => scope.execute({ type: "sessionUpstream.settle", input }),
    {
      assertCurrent,
      createAdmission: () => ({
        nativeLocations: [context.admission.databasePath],
        admission: createSqliteWorkerOperationAdmission((request, grant) => {
          if (request.stage !== "transaction" && request.stage !== "commit") {
            throw new Error("Upstream settlement requires transaction admission");
          }
          context.admission.assertCurrent();
          assertCurrent();
          assertSessionEntryCurrentAdmission(request, sessionEntryCurrent);
          grant();
        }),
      }),
    },
  );
}
