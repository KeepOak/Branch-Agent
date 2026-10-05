import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { BRANCH_AGENT_SCHEMA_VERSION } from "../state/branch-agent-db-contract.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { prepareDoctorDatabasePreflight } from "./doctor-database-preflight.js";

it.each([true, false])(
  "preserves an unregistered custom WAL store before repair (known history: %s)",
  async (knownHistory) => {
    await withBranchTestState({ scenario: "minimal" }, async (state) => {
      const sharedStatePath = knownHistory
        ? openBranchStateDatabase({ env: state.env }).path
        : undefined;
      closeBranchStateDatabaseForTest();
      const storeDir = state.path("custom-store");
      fs.mkdirSync(storeDir);
      const pathname = path.join(storeDir, "sessions.sqlite");
      const writer = new DatabaseSync(state.path("fixture-writer.sqlite"));
      try {
        writer.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA wal_autocheckpoint=0;
        CREATE TABLE schema_meta (
          meta_key TEXT PRIMARY KEY, role TEXT, schema_version INTEGER, agent_id TEXT,
          app_version TEXT, created_at INTEGER, updated_at INTEGER
        );
        INSERT INTO schema_meta VALUES ('primary', 'agent', ${BRANCH_AGENT_SCHEMA_VERSION - 1}, 'retired-owner', 'fixture', 1, 1);
        PRAGMA user_version=${BRANCH_AGENT_SCHEMA_VERSION - 1};
      `);
        fs.copyFileSync(state.path("fixture-writer.sqlite"), pathname);
        fs.copyFileSync(state.path("fixture-writer.sqlite-wal"), `${pathname}-wal`);
      } finally {
        writer.close();
      }
      await state.writeConfig({
        agents: { entries: { main: {} } },
        session: { store: pathname },
      });
      const sourceFiles = [
        pathname,
        `${pathname}-wal`,
        state.configPath,
        ...(sharedStatePath ? [sharedStatePath] : []),
      ];
      const before = sourceFiles.map((file) => fs.readFileSync(file));
      const sharedStateDir = state.statePath("state");
      expect(fs.existsSync(sharedStateDir)).toBe(knownHistory);

      const result = await prepareDoctorDatabasePreflight();

      expect(result).toMatchObject({
        incompatible: [],
        indeterminate: [],
      });
      expect(result.pendingMigrations ?? []).toEqual(
        knownHistory
          ? [
              expect.objectContaining({
                kind: "agent",
                path: pathname,
                foundVersion: BRANCH_AGENT_SCHEMA_VERSION - 1,
              }),
            ]
          : [],
      );
      if (!knownHistory) {
        expect(result.agentDatabaseMigrationDiscovery?.discovery).toMatchObject({
          deletionJournal: {
            status: "unavailable",
            reason: "shared state database missing",
          },
          targets: [],
          retainedTargets: [],
          unverifiedTargets: [
            {
              agentId: "retired-owner",
              path: pathname,
              realPath: fs.realpathSync.native(pathname),
              source: "configured",
            },
          ],
          registryRemovals: [],
          failures: [],
        });
      }
      expect(result.agentRefusals ?? []).toEqual([]);
      expect(fs.readdirSync(storeDir).toSorted()).toEqual([
        "sessions.sqlite",
        "sessions.sqlite-wal",
      ]);
      expect(sourceFiles.map((file) => fs.readFileSync(file))).toEqual(before);
      expect(fs.existsSync(sharedStateDir)).toBe(knownHistory);
    });
  },
);
