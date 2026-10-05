import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  beginAgentDeletionJournal,
  readAgentDeletionJournal,
  removeAgentDeletionJournal,
} from "./agent-deletion-journal.js";
import * as agentDeletionJournal from "./agent-deletion-journal.js";
import {
  assertNoBranchAgentDatabaseLeases,
  claimBranchAgentDatabaseLease,
  releaseBranchAgentDatabaseLease,
} from "./branch-agent-db-lease.js";
import { registerBranchAgentDatabase } from "./branch-agent-db-registry.js";
import { closeBranchStateDatabaseForTest } from "./branch-state-db-cache.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";

afterEach(() => {
  closeBranchStateDatabaseForTest();
});
const tempDirs = useAutoCleanupTempDirTracker(afterEach);

it.each([
  ["registration", "database_paths_json", "[1]"],
  ["lease claim", "cleanup_paths_json", "[1]"],
  ["lease drain", "database_paths_json", "[1]"],
  ["lease drain", "cleanup_paths_json", "[1]"],
  ["registration", "operation_id", "replacement"],
  ["lease claim", "cleanup_completed", 1],
  ["lease drain", "operation_id", "replacement"],
] as const)("%s classifies changed %s=%s", (caller, column, value) => {
  const afterPrepare = column === "operation_id" || column === "cleanup_completed";
  const error = afterPrepare
    ? "deletion journal changed"
    : column === "database_paths_json"
      ? "Invalid agent deletion database path journal."
      : "Invalid agent deletion cleanup path journal.";
  const stateDir = tempDirs.make("agent-deletion-journal-fence-");
  const env = { BRANCH_STATE_DIR: stateDir };
  const claim = { agentId: "survivor", path: path.join(stateDir, "survivor.sqlite"), env };
  let leaseId = caller === "lease drain" ? claimBranchAgentDatabaseLease(claim) : undefined;
  const deletion = beginAgentDeletionJournal(
    {
      operationId: "deletion",
      deleteFiles: true,
      agentId: "deleted",
      agentDir: path.join(stateDir, "agents", "deleted", "agent"),
      workspaceDir: path.join(stateDir, "workspace-deleted"),
      sessionsDir: path.join(stateDir, "sessions-deleted"),
    },
    { env },
  );
  const writer = new DatabaseSync(resolveBranchStateSqlitePath(env));
  const registrations = writer.prepare("SELECT * FROM agent_databases ORDER BY agent_id, path");
  const leases = writer.prepare("SELECT * FROM agent_database_leases ORDER BY lease_id");
  const beforeRegistrations = registrations.all();
  const beforeLeases = leases.all();
  const mutate = () =>
    writer
      .prepare(`UPDATE agent_deletion_journal SET ${column} = ? WHERE agent_id = ?`)
      .run(value, deletion.agentId);
  const prepare = agentDeletionJournal.prepareAgentDeletionPathFence;
  const preparation = afterPrepare
    ? vi
        .spyOn(agentDeletionJournal, "prepareAgentDeletionPathFence")
        .mockImplementationOnce((...args) => {
          const fence = prepare(...args);
          // Commit through another connection after preparation releases its transaction.
          mutate();
          return fence;
        })
    : undefined;
  try {
    if (!afterPrepare) {
      mutate();
      expect(readAgentDeletionJournal(claim.agentId, { env })).toBeUndefined();
    }
    const operate = () => {
      if (caller === "registration") {
        registerBranchAgentDatabase(claim);
      } else if (caller === "lease claim") {
        leaseId = claimBranchAgentDatabaseLease(claim);
      } else {
        assertNoBranchAgentDatabaseLeases(deletion.agentId, { env });
      }
    };
    const refuses = afterPrepare || caller === "lease drain";
    if (refuses) {
      expect(operate).toThrow(error);
    } else {
      expect(operate).not.toThrow();
      expect(prepare(claim, { env }).journal).toBe("unknown");
    }
    expect(registrations.all()).toEqual(
      !refuses && caller === "registration"
        ? [expect.objectContaining({ agent_id: claim.agentId, path: "survivor.sqlite" })]
        : beforeRegistrations,
    );
    expect(leases.all()).toEqual(
      !refuses && caller === "lease claim"
        ? [
            expect.objectContaining({
              lease_id: leaseId,
              agent_id: claim.agentId,
              path: claim.path,
            }),
          ]
        : beforeLeases,
    );
    expect(
      writer
        .prepare(`SELECT ${column} FROM agent_deletion_journal WHERE agent_id = ?`)
        .get(deletion.agentId),
    ).toEqual({ [column]: value });
  } finally {
    preparation?.mockRestore();
    writer.close();
    if (leaseId) {
      releaseBranchAgentDatabaseLease(leaseId, { env });
    }
    removeAgentDeletionJournal(
      deletion.agentId,
      column === "operation_id" ? "replacement" : deletion.operationId,
      { env },
    );
  }
});

it.each(["registration", "lease claim"])(
  "preserves a recorded deletion identity during %s with unreadable path history",
  (caller) => {
    const stateDir = tempDirs.make("agent-deletion-known-identity-");
    const env = { BRANCH_STATE_DIR: stateDir };
    const claim = { agentId: "deleted", path: path.join(stateDir, "deleted.sqlite"), env };
    beginAgentDeletionJournal(
      {
        agentId: claim.agentId,
        operationId: "known-deletion",
        agentDir: path.join(stateDir, "agents/deleted/agent"),
        workspaceDir: path.join(stateDir, "workspace-deleted"),
        sessionsDir: path.join(stateDir, "sessions-deleted"),
        deleteFiles: false,
      },
      { env },
    );
    using writer = new DatabaseSync(resolveBranchStateSqlitePath(env));
    writer.exec("UPDATE agent_deletion_journal SET database_paths_json = '[1]'");
    expect(agentDeletionJournal.prepareAgentDeletionPathFence(claim, { env }).journal).toBe(
      "unknown",
    );
    expect(() =>
      caller === "registration"
        ? registerBranchAgentDatabase(claim)
        : claimBranchAgentDatabaseLease(claim),
    ).toThrow("while agent deleted is deleted");
    expect(writer.prepare("SELECT * FROM agent_databases").all()).toEqual([]);
    expect(writer.prepare("SELECT * FROM agent_database_leases").all()).toEqual([]);
  },
);
