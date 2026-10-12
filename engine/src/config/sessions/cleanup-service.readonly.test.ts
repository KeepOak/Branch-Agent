import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { openNodeSqliteDatabase } from "../../infra/node-sqlite.js";
import { closeBranchAgentDatabasesForTest } from "../../state/branch-agent-db.js";
import { clearBranchAgentIntegrityVerification } from "../../state/branch-quarantine-store.js";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import {
  resolveBranchStateSqlitePath,
  resolveQuarantineStorePath,
} from "../../state/branch-state-db.paths.js";
import { runSessionsCleanup } from "./cleanup-service.js";
import { replaceSessionEntrySync } from "./session-accessor.entry.js";
import { resolveSqliteTargetFromSessionStorePath } from "./session-sqlite-target.js";

const maintenance = vi.hoisted(() => ({
  mode: "enforce",
  pruneAfterMs: Number.MAX_SAFE_INTEGER,
  archiveDashboardAfterMs: null,
  modelRunPruneAfterMs: 24 * 60 * 60 * 1000,
  maxEntries: 5000,
  preserveRecentMs: null,
  resetArchiveRetentionMs: null,
  maxDiskBytes: null as number | null,
  highWaterBytes: null as number | null,
}));
vi.mock("./store-maintenance-runtime.js", () => ({
  resolveMaintenanceConfig: () => maintenance,
}));

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => {
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
  vi.unstubAllEnvs();
});

function readMetadata() {
  const state = openNodeSqliteDatabase(resolveBranchStateSqlitePath(), { readOnly: true });
  const quarantine = openNodeSqliteDatabase(resolveQuarantineStorePath(process.env), {
    readOnly: true,
  });
  try {
    return {
      registry: state.prepare("SELECT * FROM agent_databases ORDER BY agent_id, path").all(),
      integrity: quarantine
        .prepare("SELECT * FROM agent_integrity_verifications ORDER BY path")
        .all(),
    };
  } finally {
    quarantine.close();
    state.close();
  }
}

it.each([
  { name: "ordinary preview", fixMissing: false, diskBudget: false },
  { name: "missing transcript preview", fixMissing: true, diskBudget: false },
  { name: "over-budget preview", fixMissing: false, diskBudget: true },
])(
  "keeps cold database contents and metadata unchanged during $name",
  async ({ fixMissing, diskBudget }) => {
    const stateDir = tempDirs.make("branch-cleanup-readonly-");
    vi.stubEnv("BRANCH_STATE_DIR", stateDir);
    const storePath = path.join(stateDir, "agents", "main", "sessions", "sessions.json");
    maintenance.maxDiskBytes = null;
    maintenance.highWaterBytes = null;
    replaceSessionEntrySync(
      { agentId: "main", sessionKey: "agent:main:readonly", storePath },
      { sessionId: "readonly-session", updatedAt: Date.now() },
    );
    const sqlitePath = resolveSqliteTargetFromSessionStorePath(storePath, { agentId: "main" }).path;
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    clearBranchAgentIntegrityVerification(sqlitePath, process.env);
    const state = openNodeSqliteDatabase(resolveBranchStateSqlitePath());
    try {
      state.exec("UPDATE agent_databases SET last_seen_at = 1");
    } finally {
      state.close();
    }
    const metadata = readMetadata();
    expect(metadata.registry).toHaveLength(1);
    expect(metadata.integrity).toEqual([]);
    const databaseBytes = fs.readFileSync(sqlitePath);
    maintenance.maxDiskBytes = diskBudget ? 1 : null;
    maintenance.highWaterBytes = diskBudget ? 1 : null;

    const result = await runSessionsCleanup({
      cfg: {},
      opts: { dryRun: true, fixMissing, enforce: true },
      targets: [{ agentId: "main", storePath }],
    });

    expect(result.previewResults[0]?.summary).toMatchObject({
      beforeCount: 1,
      afterCount: fixMissing ? 0 : 1,
      missing: fixMissing ? 1 : 0,
      wouldMutate: fixMissing,
    });
    expect(result.appliedSummaries).toEqual([]);
    expect.soft(readMetadata()).toEqual(metadata);
    expect(fs.readFileSync(sqlitePath)).toEqual(databaseBytes);
  },
);
