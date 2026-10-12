import type { SqliteWorkerCommand } from "../../infra/sqlite-worker-contract.js";
import { createSqliteWorkerOperationAdmission } from "../../infra/sqlite-worker-operation-admission.js";
import type { SqliteWorkerOperationSettlement } from "../../infra/sqlite-worker-operation-settlement.js";
import { captureBranchStateWorkerContext } from "../../state/branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "../../state/branch-state-worker-context.types.js";
import type { BranchStateWorkerOperations } from "../../state/branch-state-worker-contract.js";
import type { WorktreeRunLeaseRowInput } from "./run-lease-store.kernel.js";

export async function admitWorktreeRunLeaseRowAsync(
  context: BranchStateWorkerContext,
  input: WorktreeRunLeaseRowInput,
  onSettlement: (kind: SqliteWorkerOperationSettlement["kind"]) => void,
): Promise<void> {
  await runLeaseCommand(context, { type: "worktrees.admitRunLease", input }, onSettlement);
  context.admission.assertCurrent();
}

export async function releaseWorktreeRunLeaseRowAsync(
  env: NodeJS.ProcessEnv,
  worktreeId: string,
  token: string,
  context: BranchStateWorkerContext = captureBranchStateWorkerContext({ env }),
): Promise<void> {
  await runLeaseCommand(context, {
    type: "worktrees.releaseRunLease",
    input: { worktreeId, token },
  });
}

export async function reapWorktreeRunLeases(
  env: NodeJS.ProcessEnv,
  scopes: string[],
  assertCurrent?: () => void,
): Promise<void> {
  if (scopes.length > 0) {
    await runLeaseCommand(
      captureBranchStateWorkerContext({ env }),
      { type: "worktrees.reapRunLeases", input: { scopes } },
      undefined,
      assertCurrent,
    );
  }
}

async function runLeaseCommand(
  context: BranchStateWorkerContext,
  command: SqliteWorkerCommand<
    Pick<
      BranchStateWorkerOperations,
      "worktrees.admitRunLease" | "worktrees.releaseRunLease" | "worktrees.reapRunLeases"
    >
  >,
  onSettlement?: (kind: SqliteWorkerOperationSettlement["kind"]) => void,
  assertCurrent?: () => void,
): Promise<void> {
  let settled: Promise<SqliteWorkerOperationSettlement> | undefined;
  try {
    const { runBranchStateWorkerOperation } =
      await import("../../state/branch-state-worker-store.js");
    await runBranchStateWorkerOperation(context, (scope) => scope.execute(command), {
      createAdmission: (operation) => {
        settled = operation.settled;
        return {
          nativeLocations: [context.admission.databasePath],
          admission: createSqliteWorkerOperationAdmission((_request, grant) => {
            context.admission.assertCurrent();
            assertCurrent?.();
            grant();
          }),
        };
      },
    });
  } finally {
    // A rejected delivery can precede failed native cleanup; it does not authorize compensation.
    onSettlement?.((await settled)?.kind ?? "not-entered");
  }
}
