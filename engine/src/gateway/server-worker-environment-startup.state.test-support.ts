import { closeBranchStateDatabaseByPathAsync } from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { withEnvAsync } from "../test-utils/env.js";

export async function withGatewayWorkerEnvironmentStartupState<T>(
  stateDir: string,
  run: () => Promise<T>,
): Promise<T> {
  const databasePath = resolveBranchStateSqlitePath({ BRANCH_STATE_DIR: stateDir });
  return await withEnvAsync({ BRANCH_STATE_DIR: stateDir }, async () => {
    let result: T;
    try {
      result = await run();
    } catch (bodyError) {
      const [cleanup] = await Promise.allSettled([
        closeBranchStateDatabaseByPathAsync(databasePath),
      ]);
      if (cleanup.status === "rejected") {
        throw new AggregateError(
          [bodyError, cleanup.reason],
          "Worker environment startup fixture and database cleanup failed",
          { cause: bodyError },
        );
      }
      throw bodyError;
    }
    await closeBranchStateDatabaseByPathAsync(databasePath);
    return result;
  });
}
