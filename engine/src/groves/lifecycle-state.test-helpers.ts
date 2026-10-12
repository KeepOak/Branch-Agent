import { loadConfig } from "../config/config.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { BranchTestState } from "../test-utils/branch-test-state.js";
import { applyGroveAddPlan } from "./add.js";
import { buildGroveRemovalFixture } from "./lifecycle-remove.test-support.js";

export function createGroveRemoveTestFixtures(
  tempDirs: { make: (prefix: string) => string },
  getState: () => BranchTestState,
) {
  async function fixture(params: Parameters<typeof buildGroveRemovalFixture>[1] = {}) {
    const current = await buildGroveRemovalFixture(tempDirs.make("branch-grove-remove-"), params);
    return { ...current, env: { BRANCH_STATE_DIR: getState().stateDir } };
  }

  async function addFixture(params: Parameters<typeof fixture>[0] = {}) {
    const current = await fixture(params);
    let config: BranchConfig = {};
    await applyGroveAddPlan(current.plan, {
      consentPlanIntegrity: current.plan.planIntegrity,
      env: current.env,
      commitConfig: async (transform) => {
        config = transform(config);
        await getState().writeConfig(config);
      },
      cronGateway: { add: async () => ({ id: "scheduler-daily" }) },
      ...(params.withMcp ? { installMcpServers: async () => [] } : {}),
    });
    return { ...current, getConfig: loadConfig };
  }

  return { fixture, addFixture };
}
