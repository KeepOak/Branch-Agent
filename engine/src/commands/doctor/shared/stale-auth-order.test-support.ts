import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AuthProfileStore } from "../../../agents/auth-profiles/types.js";
import type { BranchConfig } from "../../../config/types.branch.js";
import { closeBranchAgentDatabasesForTest } from "../../../state/branch-agent-db.js";
import { closeBranchStateDatabaseForTest } from "../../../state/branch-state-db.js";
import { withEnvAsync } from "../../../test-utils/env.js";
import "./stale-auth-order.js";

export async function withStateDir<T>(
  prefix: string,
  run: (stateDir: string) => Promise<T>,
): Promise<T> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await withEnvAsync(
      {
        BRANCH_STATE_DIR: stateDir,
        BRANCH_CONFIG_PATH: path.join(stateDir, "branch.json"),
      },
      () => run(stateDir),
    );
  } finally {
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

type TestApi = {
  repairStaleConfiguredAuthOrders(params: {
    cfg: BranchConfig;
    stores: readonly AuthProfileStore[];
    activeStores?: readonly AuthProfileStore[];
    runtimeProfileIds?: ReadonlySet<string>;
  }): { config: BranchConfig; changes: string[] };
};

function getTestApi(): TestApi {
  return (globalThis as Record<PropertyKey, unknown>)[
    Symbol.for("branch.staleAuthOrderTestApi")
  ] as TestApi;
}

export const repairStaleConfiguredAuthOrders: TestApi["repairStaleConfiguredAuthOrders"] = (
  params,
) => getTestApi().repairStaleConfiguredAuthOrders(params);
