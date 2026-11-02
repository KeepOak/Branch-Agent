import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDirs, makeTempDir } from "../../test/helpers/temp-dir.js";
import {
  claimBranchAgentDatabaseLease,
  releaseBranchAgentDatabaseLease,
} from "../state/branch-agent-db-lease.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
} from "../state/branch-state-db.js";
import { openNodeSqliteDatabase } from "./node-sqlite.js";
import { createLegacyStateMigrationStepReceipt } from "./state-migrations.messages.js";
import { migrateHistoricalTranscriptDirectives } from "./state-migrations.transcript-directives.js";

const tempDirs: string[] = [];

function readMigrationCursor(databasePath: string): unknown {
  const database = openNodeSqliteDatabase(databasePath, { readOnly: true });
  try {
    const row = database
      .prepare("SELECT app_version FROM schema_meta WHERE meta_key = ?")
      .get("historical-transcript-directives-v1") as { app_version: string } | undefined;
    return row ? JSON.parse(row.app_version) : undefined;
  } finally {
    database.close();
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  // Drain worker-held handles before rm; Windows refuses to delete open SQLite files.
  await closeBranchAgentDatabasesAsync();
  await closeBranchStateDatabaseAsync();
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
  cleanupTempDirs(tempDirs);
});

describe("historical transcript directive migration while Branch is running", () => {
  it("defers without refusing doctor when another process holds an agent database (#1988)", async () => {
    const stateDir = makeTempDir(tempDirs, "transcript-directive-held-agent-");
    const env = { BRANCH_STATE_DIR: stateDir };
    const pending = openBranchAgentDatabase({ agentId: "main", env }).path;
    const held = openBranchAgentDatabase({ agentId: "juniper", env }).path;
    closeBranchAgentDatabasesForTest();
    // The running app or gateway keeps this live lease while doctor runs.
    const leaseId = claimBranchAgentDatabaseLease({ agentId: "juniper", path: held, env });
    try {
      const result = await migrateHistoricalTranscriptDirectives({ env });

      expect(result.changes).toEqual([]);
      expect(result.warningDisposition).toBe("recoverable");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("in use by a running Branch process");
      expect(result.warnings[0]).not.toContain("BranchAgentDatabaseLeaseActiveError");
      const receipt = createLegacyStateMigrationStepReceipt(
        {
          id: "transcript-directives",
          phase: "shared",
          source: [],
          target: [],
          requiredness: "conditional",
          reversibility: "not-applicable",
        },
        result,
      );
      expect(receipt.outcome).toBe("warning");
      expect(receipt.refusal).toBeUndefined();
      // Doctor never writes while another process holds a lease.
      expect(readMigrationCursor(pending)).toBeUndefined();
    } finally {
      releaseBranchAgentDatabaseLease(leaseId, { env });
    }
  });

  it("completes once the other process releases its lease", async () => {
    const stateDir = makeTempDir(tempDirs, "transcript-directive-released-agent-");
    const env = { BRANCH_STATE_DIR: stateDir };
    const pending = openBranchAgentDatabase({ agentId: "main", env }).path;
    const held = openBranchAgentDatabase({ agentId: "juniper", env }).path;
    closeBranchAgentDatabasesForTest();
    const leaseId = claimBranchAgentDatabaseLease({ agentId: "juniper", path: held, env });
    await migrateHistoricalTranscriptDirectives({ env });
    releaseBranchAgentDatabaseLease(leaseId, { env });

    await expect(migrateHistoricalTranscriptDirectives({ env })).resolves.toEqual({
      changes: [],
      warnings: [],
    });
    expect(readMigrationCursor(pending)).toEqual({ phase: "complete" });
  });
});
