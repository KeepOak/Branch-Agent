import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { vi } from "vitest";
import { writeSessionEntry } from "../config/sessions/session-accessor.sqlite-entry-store.js";
import { reconstructAgentDeletionJournal } from "../state/agent-deletion-journal-recovery.js";
import { readAgentDeletionRecoveryHolds } from "../state/agent-deletion-journal-recovery.kernel.js";
import {
  closeBranchAgentDatabasesForTest,
  runBranchAgentWriteTransaction,
} from "../state/branch-agent-db.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
} from "../state/branch-state-db.js";
import { captureEnv, setTestEnvValue } from "../test-utils/env.js";
import { nodeFilePath } from "../test-utils/node-file-path.js";
import type { BranchTestState } from "../test-utils/branch-test-state.js";

export async function prepareRecoveryHolds(
  state: BranchTestState,
  agentId: string,
  held = [
    { agentId, path: path.join(state.agentDir(agentId), "branch-agent.sqlite") },
    { agentId, path: state.path("parked", "branch-agent.sqlite") },
    { agentId: "kept", path: path.join(state.agentDir("kept"), "branch-agent.sqlite") },
  ],
) {
  for (const target of held) {
    runBranchAgentWriteTransaction(
      (database) =>
        writeSessionEntry(
          database,
          `agent:${target.agentId}:main`,
          {
            sessionId: `preserved-${target.agentId}`,
            updatedAt: 1,
          },
          { previousEntry: null },
        ),
      { ...target, env: state.env },
    );
  }
  closeBranchAgentDatabasesForTest();
  runBranchStateWriteTransaction(
    (database) => {
      database.db.exec("DROP TABLE agent_deletion_journal");
      reconstructAgentDeletionJournal(database, held);
    },
    { env: state.env },
  );
  return {
    held,
    bytes: await Promise.all(held.map((target) => fs.readFile(target.path))),
    readHolds: () => readAgentDeletionRecoveryHolds(openBranchStateDatabase({ env: state.env })),
  };
}

export function installWorkspacePreparationPause(
  workspace: string,
  phase: "workspace" | "workspace-write" | "config",
  pause: (phase: "workspace" | "workspace-write" | "config") => Promise<void>,
): () => void {
  const nativeModeEnv = captureEnv(["FS_SAFE_NATIVE_MODE"]);
  if (phase === "workspace-write") {
    setTestEnvValue("FS_SAFE_NATIVE_MODE", "off");
  }
  const realAccess = fs.access.bind(fs);
  const access = vi.spyOn(fs, "access").mockImplementation(async (file, mode) => {
    if (phase === "workspace" && file === path.join(workspace, "AGENTS.md")) {
      await pause("workspace");
    }
    return await realAccess(file, mode);
  });
  const realOpen = fs.open.bind(fs);
  const restoreWrites: Array<() => void> = [];
  let writePaused = false;
  const open = vi.spyOn(fs, "open").mockImplementation(async (file, flags, mode) => {
    const handle = await realOpen(file, flags, mode);
    const filePath = nodeFilePath(file);
    if (
      phase === "workspace-write" &&
      filePath &&
      path.dirname(filePath) === workspace &&
      typeof flags === "number" &&
      (flags & fsConstants.O_EXCL) !== 0
    ) {
      const realWrite = handle.write.bind(handle);
      const write = vi.spyOn(handle, "write").mockImplementation(async (...args) => {
        const result = await realWrite(...args);
        if (!writePaused) {
          writePaused = true;
          await pause("workspace-write");
        }
        return result;
      });
      restoreWrites.push(() => write.mockRestore());
    }
    return handle;
  });
  return () => {
    open.mockRestore();
    for (const restore of restoreWrites) {
      restore();
    }
    access.mockRestore();
    nativeModeEnv.restore();
  };
}
