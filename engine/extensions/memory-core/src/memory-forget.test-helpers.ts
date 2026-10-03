import type { BranchConfig } from "branch/plugin-sdk/memory-core-host-engine-foundation";
import { resetPluginStateStoreForTests } from "branch/plugin-sdk/plugin-state-test-runtime";
import { patchSessionEntry } from "branch/plugin-sdk/session-store-runtime";
import { openBranchAgentDatabase } from "branch/plugin-sdk/sqlite-runtime";
import { createBranchTestState } from "branch/plugin-sdk/test-state";
import { configureMemoryCoreRingsStateForTests } from "./test-helpers.js";

export async function createMemoryForgetFixture(prefix = "branch-memory-forget-") {
  const state = await createBranchTestState({ prefix, layout: "state-only" });
  const { stateDir, workspaceDir } = state;
  await configureMemoryCoreRingsStateForTests();
  const cfg: BranchConfig = {
    agents: { defaults: { workspace: workspaceDir }, list: [{ id: "main", default: true }] },
  };
  return {
    stateDir,
    workspaceDir,
    cfg,
    cleanup: async () => {
      await state.restoreEnv();
      resetPluginStateStoreForTests();
      await state.cleanup();
    },
  };
}

export async function seedMemoryForgetSession(
  sessionId: string,
  hookSource?: "gmail" | "webhook",
): Promise<void> {
  const sessionKey = `agent:main:${sessionId}`;
  const entry = { sessionId, updatedAt: 1_000 };
  await patchSessionEntry({
    agentId: "main",
    sessionKey,
    update: () => entry,
    fallbackEntry: entry,
    replaceEntry: true,
    // Retention workers must not race direct schema setup or reclaim fixture sessions.
    skipMaintenance: true,
  });
  if (hookSource) {
    openBranchAgentDatabase({ agentId: "main" })
      .db.prepare(
        "UPDATE session_windows SET hook_external_content_source = ? WHERE session_id = ?",
      )
      .run(hookSource, sessionId);
  }
}
