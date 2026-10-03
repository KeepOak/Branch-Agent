import { expect, it } from "vitest";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { collectStatusLocalSnapshot } from "./status.agent-local.js";
import { buildStatusAgentsValue } from "./status.command-sections.js";

it("does not project the gateway's compatibility id as an explicit fleet default", async () => {
  await withBranchTestState({ label: "status-explicit-fleet" }, async () => {
    const { agentStatus } = await collectStatusLocalSnapshot({
      agents: { ownership: "explicit", entries: { alpha: {}, beta: {} } },
    });
    expect(agentStatus).toMatchObject({
      defaultId: null,
      ownership: "explicit",
      selectionRequired: true,
      agents: [{ id: "alpha" }, { id: "beta" }],
    });
    expect(buildStatusAgentsValue({ agentStatus })).toBe(
      "2 · no workspaces bootstrapping · sessions 0",
    );
  });
});
