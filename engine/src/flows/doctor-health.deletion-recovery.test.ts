import "./doctor-health.test-support.js";
import fs from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { prepareDoctorDatabasePreflight } from "../commands/doctor-database-preflight.js";
import type { BranchConfig } from "../config/types.branch.js";
import { createLegacyDatabaseFixture } from "../infra/state-migrations.media-persistence.test-support.js";
import { readAgentDeletionRecoveryHolds } from "../state/agent-deletion-journal-recovery.js";
import { unregisterBranchAgentDatabase } from "../state/branch-agent-db-registry.js";
import {
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
      await expect(
        runDoctorHealthFlow(runtime, { repair: true, nonInteractive: true }, undefined, prepared),
      ).rejects.toThrow("Failing check agent-deletion-journal");
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
