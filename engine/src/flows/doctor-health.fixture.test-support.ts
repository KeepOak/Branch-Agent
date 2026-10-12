import fs from "node:fs";
import path from "node:path";
import { afterEach, aroundEach, beforeAll, beforeEach, vi } from "vitest";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { withSqliteReadOnlyWorkerScope } from "../infra/sqlite-readonly-worker.js";
import { resolveBranchAgentSqlitePath } from "../state/branch-agent-db.js";
import { removeCanonicalValidationFromHistoricalAgentFixture } from "../state/branch-agent-db.test-support.js";
import { seedBranchAgentSchemaV21 } from "../state/branch-agent-schema-v21.test-support.js";
import {
  closeBranchStateDatabaseByPathAsync,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { mocks } from "./doctor-health.test-support.js";

export function useDoctorHealthFixture() {
  let sharedStateTemplate: Buffer;

  function materializeSharedStateDatabase(env: NodeJS.ProcessEnv) {
    const databasePath = resolveBranchStateSqlitePath(env);
    if (!fs.existsSync(databasePath)) {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
      fs.writeFileSync(databasePath, sharedStateTemplate, { flag: "wx" });
    }
  }

  function openHistoricalAgentDatabase(options: {
    agentId: string;
    env: NodeJS.ProcessEnv;
    path?: string;
  }) {
    materializeSharedStateDatabase(options.env);
    openBranchStateDatabase({ env: options.env });
    const databasePath = resolveBranchAgentSqlitePath(options);
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const db = openNodeSqliteDatabase(databasePath);
    seedBranchAgentSchemaV21(db, options.agentId);
    removeCanonicalValidationFromHistoricalAgentFixture(db);
    db.exec(
      "DROP TABLE session_participants; PRAGMA user_version = 17; UPDATE schema_meta SET schema_version = 17;",
    );
    return { db, path: databasePath };
  }

  aroundEach((runTest) => withSqliteReadOnlyWorkerScope(runTest));
  afterEach(() => vi.unstubAllEnvs());

  beforeAll(async () => {
    await withBranchTestState({ scenario: "minimal" }, async (state) => {
      mocks.runtimeTmpDir.mockReturnValue(state.path("runtime"));
      const database = openBranchStateDatabase({ env: state.env });
      await closeBranchStateDatabaseByPathAsync(database.path);
      sharedStateTemplate = fs.readFileSync(database.path);
    });
  });

  beforeEach(() => {
    vi.stubEnv("BRANCH_SERVICE_REPAIR_POLICY", undefined);
    mocks.config.mockReturnValue({});
    mocks.packageRoot.mockReturnValue(undefined);
    mocks.service.mockReset();
    mocks.probePortUsage.mockReset().mockResolvedValue("free");
    mocks.restartedHealthy = true;
    mocks.emulateNativeInstall = true;
    mocks.servicePlatform = undefined;
    mocks.taskDefinitelyStopped.mockReset().mockReturnValue(true);
    mocks.startupFallbackRuntime.mockReset().mockResolvedValue(null);
    mocks.outro.mockClear();
    mocks.runContributions.mockReset().mockResolvedValue(undefined);
    mocks.writeUpdatePostInstallDoctorResult.mockClear();
  });

  return { materializeSharedStateDatabase, openHistoricalAgentDatabase };
}
