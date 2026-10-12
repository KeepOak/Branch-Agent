import "./doctor-health.test-support.js";
import fs from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { prepareDoctorDatabasePreflight } from "../commands/doctor-database-preflight.js";
import type { BranchConfig } from "../config/types.branch.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { createLegacyDatabaseFixture } from "../infra/state-migrations.media-persistence.test-support.js";
import { readAgentDeletionRecoveryHolds } from "../state/agent-deletion-journal-recovery.kernel.js";
import { beginAgentDeletionJournal } from "../state/agent-deletion-journal.js";
import { closeBranchAgentDatabasesAsync } from "../state/branch-agent-db-lifecycle.js";
import { unregisterBranchAgentDatabase } from "../state/branch-agent-db-registry.js";
import { openBranchAgentDatabase } from "../state/branch-agent-db.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
} from "../state/branch-state-db.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { runDoctorHealthFlow } from "./doctor-health.js";

const { mocks } = await import("./doctor-health.test-support.js");

it("refreshes supplied missing-history discovery after maintenance admits a newer configured store", async () => {
  await withBranchTestState({ scenario: "minimal" }, async (state) => {
    const before: BranchConfig = { agents: { entries: { main: {} } } };
    await state.writeConfig(before);
    const mainPath = createLegacyDatabaseFixture({
      env: state.env,
      eventsBySession: {},
      schemaVersion: 19,
    });
    const lateDir = state.path("external-agent");
    const latePath = createLegacyDatabaseFixture({
      agentId: "late",
      env: state.env,
      eventsBySession: {},
      schemaVersion: 19,
      path: path.join(lateDir, "branch-agent.sqlite"),
    });
    unregisterBranchAgentDatabase({ agentId: "late", path: latePath, env: state.env });
    runBranchStateWriteTransaction(
      (database) => database.db.exec("DROP TABLE agent_deletion_journal"),
      { env: state.env },
    );
    closeBranchStateDatabaseForTest();
    const prepared = await prepareDoctorDatabasePreflight({ cfg: before });
    expect(
      prepared.agentDatabaseMigrationDiscovery?.discovery.unverifiedTargets.map(
        (target) => target.path,
      ),
    ).toEqual([mainPath]);

    const after: BranchConfig = {
      agents: { ownership: "explicit", entries: { main: {}, late: { agentDir: lateDir } } },
    };
    await state.writeConfig(after);
    const bytes = [mainPath, latePath].map((file) => fs.readFileSync(file));
    mocks.config.mockReturnValue(after);
    mocks.packageRoot.mockReturnValue(undefined);
    mocks.runContributions.mockReset();
    mocks.emulateNativeInstall = false;
    const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };
    try {
      await runDoctorHealthFlow(
        runtime,
        { repair: true, nonInteractive: true },
        undefined,
        prepared,
      );
      expect(runtime.exit).not.toHaveBeenCalled();
      expect(
        readAgentDeletionRecoveryHolds(openBranchStateDatabase({ env: state.env }))
          .map((target) => target.path)
          .toSorted(),
      ).toEqual([mainPath, latePath].toSorted());
      expect([mainPath, latePath].map((file) => fs.readFileSync(file))).toEqual(bytes);
    } finally {
      mocks.emulateNativeInstall = true;
      closeBranchStateDatabaseForTest();
    }
  });
});

it("keeps a newly quarantined pending deletion out of update reclamation", async () => {
  await withBranchTestState(
    { scenario: "external-service", env: { BRANCH_UPDATE_IN_PROGRESS: "1" } },
    async (state) => {
      const cfg: BranchConfig = {
        agents: { ownership: "explicit", entries: { main: { workspace: state.workspaceDir } } },
        gateway: { mode: "local" },
      };
      await state.writeConfig(cfg);
      const agentPath = openBranchAgentDatabase({ agentId: "main", env: state.env }).path;
      await closeBranchAgentDatabasesAsync(state.stateDir);
      await closeBranchStateDatabaseAsync();
      const agent = openNodeSqliteDatabase(agentPath);
      try {
        agent.exec("PRAGMA auto_vacuum=NONE; VACUUM;");
        expect(agent.prepare("PRAGMA auto_vacuum").get()?.auto_vacuum).toBe(0);
      } finally {
        agent.close();
      }
      beginAgentDeletionJournal(
        {
          agentId: "main",
          operationId: "interrupted-deletion",
          agentDir: path.dirname(agentPath),
          workspaceDir: state.workspaceDir,
          sessionsDir: path.join(state.stateDir, "agents", "main", "sessions"),
          databasePaths: [agentPath],
          deleteFiles: false,
        },
        { env: state.env },
      );
      runBranchStateWriteTransaction(
        (database) =>
          database.db.exec(
            "UPDATE agent_deletion_journal SET cleanup_paths_json = '[' WHERE agent_id = 'main'",
          ),
        { env: state.env },
      );
      await closeBranchStateDatabaseAsync();
      const bytes = fs.readFileSync(agentPath);
      const inode = fs.statSync(agentPath).ino;
      mocks.config.mockReturnValue(cfg);
      mocks.packageRoot.mockReturnValue(undefined);
      mocks.runContributions.mockReset();
      const runtime = { log: vi.fn(), error: vi.fn(), exit: vi.fn() };

      await runDoctorHealthFlow(runtime, { repair: true, nonInteractive: true });

      expect(runtime.exit).not.toHaveBeenCalled();
      expect(readAgentDeletionRecoveryHolds(openBranchStateDatabase({ env: state.env }))).toEqual(
        [{ agentId: "main", path: agentPath }],
      );
      expect(runtime.log.mock.calls.flat().join("\n")).toContain(agentPath);
      expect(fs.readFileSync(agentPath)).toEqual(bytes);
      expect(fs.statSync(agentPath).ino).toBe(inode);
    },
  );
});
