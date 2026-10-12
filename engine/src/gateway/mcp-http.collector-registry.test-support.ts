import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { configureMockSubagentRegistryPersistence } from "../agents/subagent-test-fixtures.test-helpers.js";
import {
  addSubagentRunForTests,
  resetSubagentRegistryForTests,
} from "../agents/subagents/registry/subagent-registry.test-helpers.js";
import { consumeSwarmStructuredOutput } from "../agents/tools/structured-output-tool.js";
import {
  createBranchTestState,
  type BranchTestState,
} from "../test-utils/branch-test-state.js";

export function useMcpCollectorRegistry(
  entry: Pick<
    Parameters<typeof addSubagentRunForTests>[0],
    "runId" | "childSessionKey" | "outputSchema"
  >,
) {
  let state: BranchTestState;
  beforeAll(async () => {
    state = await createBranchTestState({
      prefix: "branch-mcp-collector-registry-",
      layout: "state-only",
    });
  });
  beforeEach(async () => {
    await resetSubagentRegistryForTests({ persist: false });
    await configureMockSubagentRegistryPersistence({ persistRegistryRows: () => {} });
    await addSubagentRunForTests({ ...entry, collect: true });
  });
  afterEach(async () => {
    consumeSwarmStructuredOutput(entry.runId);
    await resetSubagentRegistryForTests();
  });
  afterAll(async () => {
    await state.cleanup();
  });
}
