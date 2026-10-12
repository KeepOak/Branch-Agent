import { resolveGitHubHost } from "../../agents/github-host-runtime.js";
import { createSqliteWorkerOperationAdmission } from "../../infra/sqlite-worker-operation-admission.js";
import { executeExistingBranchStateRead } from "../../state/branch-state-db-readonly.js";
import { captureBranchStateWorkerContext } from "../../state/branch-state-worker-context.js";
import { runBranchStateWorkerOperation } from "../../state/branch-state-worker-store.js";
import type { PreparedPoolPresenceDemand } from "./prepared-pool-presence.types.js";

export async function readPreparedPoolPresenceDemand(): Promise<
  PreparedPoolPresenceDemand | undefined
> {
  const reply = await executeExistingBranchStateRead({}, { type: "preparedPoolPresence.read" });
  if (!reply) {
    return undefined;
  }
  if (!reply.ok || reply.type !== "preparedPoolPresence.read") {
    throw new Error("Unexpected prepared-pool presence demand read result");
  }
  return reply.demand;
}

export function writePreparedPoolPresenceDemand(
  value: PreparedPoolPresenceDemand | null,
  assertCurrent: () => void,
): Promise<PreparedPoolPresenceDemand | undefined> {
  const host = value ? resolveGitHubHost() : undefined;
  const assertSelected = () => {
    assertCurrent();
    if (
      value &&
      (resolveGitHubHost() !== host || new URL(value.project.source.url).hostname !== host)
    ) {
      throw new Error("Prepared-pool presence demand is invalid");
    }
  };
  const context = captureBranchStateWorkerContext();
  return runBranchStateWorkerOperation(
    context,
    (scope) =>
      scope.execute({
        type: "preparedPoolPresence.write",
        input: value,
      }),
    {
      assertCurrent: assertSelected,
      createAdmission: () => ({
        nativeLocations: [context.admission.databasePath],
        admission: createSqliteWorkerOperationAdmission((request, grant) => {
          if (request.stage !== "transaction" && request.stage !== "commit") {
            throw new Error("Prepared-pool presence demand requires transaction admission");
          }
          context.admission.assertCurrent();
          assertSelected();
          grant();
        }),
      }),
    },
  );
}
