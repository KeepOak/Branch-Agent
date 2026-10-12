import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  runBranchAgentWriteTransaction,
} from "../../state/branch-agent-db.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
} from "../../state/branch-state-db.js";
import { migrateLegacyMainSessionKeys } from "./legacy-main-session-migration.js";
import { readExactSessionEntryRowForCanonicalRepair } from "./session-accessor.sqlite-canonical-repair.js";
import { writeSessionEntry } from "./session-accessor.sqlite-entry-store.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    await closeBranchAgentDatabasesAsync();
    await closeBranchStateDatabaseAsync();
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    cleanup();
  }),
);

function databasePath(stateDir: string, agentId: string): string {
  return path.join(stateDir, "agents", agentId, "agent", "branch-agent.sqlite");
}

function seedClaim(
  databaseAgentId: string,
  databasePathname: string,
  key: string,
  env: NodeJS.ProcessEnv,
): void {
  runBranchAgentWriteTransaction(
    (database) => {
      writeSessionEntry(
        database,
        key,
        { sessionId: `session-${key.replaceAll(":", "-")}`, updatedAt: 100 },
        { allowStoredAliases: true, previousEntry: null },
      );
    },
    { agentId: databaseAgentId, path: databasePathname, env },
  );
}

function readClaim(
  databaseAgentId: string,
  databasePathname: string,
  key: string,
  env: NodeJS.ProcessEnv,
) {
  return runBranchAgentWriteTransaction(
    (database) => readExactSessionEntryRowForCanonicalRepair(database, key)?.entry,
    { agentId: databaseAgentId, path: databasePathname, env },
  );
}

it("keys the startup shortcut to source layout and makes Doctor rescan", async () => {
  const root = fs.realpathSync.native(tempDirs.make("branch-legacy-main-layout-"));
  const stateDir = path.join(root, "state");
  fs.mkdirSync(stateDir, { recursive: true });
  const env = { ...process.env, BRANCH_AGENT_DIR: undefined, BRANCH_STATE_DIR: stateDir };
  const cfg = { agents: { entries: { ops: {} } } };
  const mainPath = databasePath(stateDir, "main");
  const opsPath = databasePath(stateDir, "ops");
  seedClaim("main", mainPath, "agent:other:keep", env);
  await migrateLegacyMainSessionKeys({ cfg, env, mode: "doctor-fix" });

  const changedStore = await migrateLegacyMainSessionKeys({
    cfg: {
      ...cfg,
      session: { store: path.join(tempDirs.make("changed-layout-"), "sessions.sqlite") },
    },
    env,
    mode: "detect",
  });
  expect(changedStore.outcomes).toEqual([{ kind: "no-legacy-rows" }]);
  expect(changedStore.ledgerComplete).toBe(false);

  const restoredPath = path.join(root, "restored-main.sqlite");
  seedClaim("main", restoredPath, "agent:main:restored", env);
  closeBranchAgentDatabasesForTest();
  fs.renameSync(mainPath, `${mainPath}.before-restore`);
  fs.renameSync(restoredPath, mainPath);
  const restored = await migrateLegacyMainSessionKeys({ cfg, env, mode: "doctor-fix" });
  expect(restored.outcomes.map((outcome) => outcome.kind)).toContain("migrated-cross-store");
  expect(readClaim("main", mainPath, "agent:main:restored", env)).toBeUndefined();
  expect(readClaim("ops", opsPath, "agent:ops:restored", env)).toBeDefined();

  const jsonPath = path.join(stateDir, "agents", "main", "sessions", "sessions.json");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, "{}\n");
  const laterJson = await migrateLegacyMainSessionKeys({ cfg, env, mode: "detect" });
  expect(laterJson.outcomes.map((outcome) => outcome.kind)).toContain("legacy-json-store");
  fs.unlinkSync(jsonPath);

  seedClaim("main", mainPath, "agent:main:late", env);
  const startupShortcut = await migrateLegacyMainSessionKeys({ cfg, env, mode: "detect" });
  expect(startupShortcut.outcomes).toEqual([
    { kind: "no-legacy-rows", detail: "matching completed ledger" },
  ]);
  expect(startupShortcut.ledgerComplete).toBe(true);
  expect(readClaim("main", mainPath, "agent:main:late", env)).toBeDefined();

  const creationScan = await migrateLegacyMainSessionKeys({
    cfg,
    env,
    mode: "detect",
    forceScan: true,
  });
  expect(creationScan.ledgerComplete).toBe(false);
  expect(creationScan.outcomes.map((outcome) => outcome.kind)).toContain("migrated-cross-store");
  expect(readClaim("main", mainPath, "agent:main:late", env)).toBeDefined();

  const repaired = await migrateLegacyMainSessionKeys({ cfg, env, mode: "doctor-fix" });
  expect(repaired.ledgerComplete).toBe(true);
  expect(repaired.outcomes.map((outcome) => outcome.kind)).toContain("migrated-cross-store");
  expect(readClaim("main", mainPath, "agent:main:late", env)).toBeUndefined();
  expect(readClaim("ops", opsPath, "agent:ops:late", env)).toBeDefined();
});
