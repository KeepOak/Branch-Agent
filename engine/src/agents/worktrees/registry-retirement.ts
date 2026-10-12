import { createSqliteWorkerOperationAdmission } from "../../infra/sqlite-worker-operation-admission.js";
import { captureBranchStateWorkerContext } from "../../state/branch-state-worker-context.js";
import type { WorktreeWorkerOperations } from "./dispatch.worker.js";

type WorktreeRetirementOperations = Pick<
  WorktreeWorkerOperations,
  "worktrees.deferCleanup" | "worktrees.retireMissing"
>;

export async function deferWorktreeCleanup(
  env: NodeJS.ProcessEnv,
  input: WorktreeRetirementOperations["worktrees.deferCleanup"]["input"],
  assertCurrent?: () => void,
) {
  return await mutateCleanupRecord(env, { type: "worktrees.deferCleanup", input }, assertCurrent);
}

export async function retireMissingRegistryWorktree(
  env: NodeJS.ProcessEnv,
  observed: WorktreeRetirementOperations["worktrees.retireMissing"]["input"]["observed"],
  removedAt: number,
  assertCurrent?: () => void,
) {
  return await mutateCleanupRecord(
    env,
    {
      type: "worktrees.retireMissing",
      input: { observed, removedAt },
    },
    assertCurrent,
  );
}

async function mutateCleanupRecord<Key extends keyof WorktreeRetirementOperations>(
  env: NodeJS.ProcessEnv,
  command: { type: Key; input: WorktreeRetirementOperations[Key]["input"] },
  assertCurrent?: () => void,
) {
  const context = captureBranchStateWorkerContext({ env });
  const { runBranchStateWorkerOperation } =
    await import("../../state/branch-state-worker-store.js");
  return await runBranchStateWorkerOperation(context, (scope) => scope.execute(command), {
    createAdmission: () => ({
      nativeLocations: [context.admission.databasePath],
      admission: createSqliteWorkerOperationAdmission((_request, grant) => {
        context.admission.assertCurrent();
        assertCurrent?.();
        grant();
      }),
    }),
  });
}
