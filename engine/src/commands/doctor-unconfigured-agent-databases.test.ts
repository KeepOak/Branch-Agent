import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { BranchConfig } from "../config/types.branch.js";
import {
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "../state/branch-agent-db.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { collectRetainedUnconfiguredAgentDatabaseWarnings } from "./doctor-unconfigured-agent-databases.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function configWithAgents(...agentIds: string[]): BranchConfig {
  return {
    agents: {
      ownership: "explicit",
      entries: Object.fromEntries(agentIds.map((id) => [id, {}])),
    },
  };
}

afterEach(() => {
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
});

describe("unconfigured agent database diagnostics", () => {
  it("does not warn for a configured agentDir database registered outside the default tree", () => {
    const stateDir = fs.realpathSync.native(tempDirs.make("doctor-configured-agentdir-"));
    const env = { BRANCH_STATE_DIR: stateDir };
    const agentDir = path.join(stateDir, ".branch", "agents", "worker", "agent");
    openBranchAgentDatabase({
      agentId: "worker",
      env,
      path: path.join(agentDir, "branch-agent.sqlite"),
    });
    closeBranchAgentDatabasesForTest();

    expect(
      collectRetainedUnconfiguredAgentDatabaseWarnings({
        cfg: { agents: { ownership: "explicit", entries: { worker: { agentDir } } } },
        env,
      }),
    ).toEqual([]);
  });

  it("reports a custom registered database that is no longer configured", () => {
    const stateDir = fs.realpathSync.native(tempDirs.make("doctor-unconfigured-agent-database-"));
    const env = { BRANCH_STATE_DIR: stateDir };
    const databasePath = path.join(stateDir, "retired.sqlite");
    openBranchAgentDatabase({ agentId: "retired", env, path: databasePath });
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();

    expect(
      collectRetainedUnconfiguredAgentDatabaseWarnings({
        cfg: configWithAgents("main"),
        env,
      }),
    ).toEqual([
      `- Retained unconfigured agent database "retired" at ${databasePath}. Doctor will not remove it automatically because it may contain retired or manually managed agent state.`,
    ]);
  });

  it("leaves default-layout orphan reporting to the state-directory check", () => {
    const stateDir = fs.realpathSync.native(tempDirs.make("doctor-default-agent-database-"));
    const env = { BRANCH_STATE_DIR: stateDir };
    openBranchAgentDatabase({ agentId: "retired", env });
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();

    expect(
      collectRetainedUnconfiguredAgentDatabaseWarnings({
        cfg: configWithAgents("main"),
        env,
      }),
    ).toEqual([]);
  });

  it("reports a custom database whose suffix resembles the default layout", () => {
    const stateDir = fs.realpathSync.native(tempDirs.make("doctor-default-shaped-custom-store-"));
    const env = { BRANCH_STATE_DIR: stateDir };
    const databasePath = path.join(
      stateDir,
      "custom",
      "agents",
      "retired",
      "agent",
      "branch-agent.sqlite",
    );
    openBranchAgentDatabase({ agentId: "retired", env, path: databasePath });
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();

    expect(
      collectRetainedUnconfiguredAgentDatabaseWarnings({
        cfg: configWithAgents("main"),
        env,
      }),
    ).toEqual([
      `- Retained unconfigured agent database "retired" at ${databasePath}. Doctor will not remove it automatically because it may contain retired or manually managed agent state.`,
    ]);
  });

  it("does not warn for a configured shared store owned by a retired agent", () => {
    const stateDir = fs.realpathSync.native(
      tempDirs.make("doctor-configured-shared-agent-database-"),
    );
    const env = { BRANCH_STATE_DIR: stateDir };
    const databasePath = path.join(stateDir, "shared.sqlite");
    openBranchAgentDatabase({ agentId: "retired", env, path: databasePath });
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();

    expect(
      collectRetainedUnconfiguredAgentDatabaseWarnings({
        cfg: {
          ...configWithAgents("worker"),
          session: { store: databasePath },
        },
        env,
      }),
    ).toEqual([]);
  });

  it("ignores missing registered databases owned by migration hygiene", () => {
    const stateDir = fs.realpathSync.native(tempDirs.make("doctor-missing-agent-database-"));
    const env = { BRANCH_STATE_DIR: stateDir };
    const databasePath = openBranchAgentDatabase({ agentId: "retired", env }).path;
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    fs.unlinkSync(databasePath);

    expect(
      collectRetainedUnconfiguredAgentDatabaseWarnings({
        cfg: configWithAgents("main"),
        env,
      }),
    ).toEqual([]);
  });

  it("reports an unreadable agent database registry", () => {
    const stateDir = fs.realpathSync.native(tempDirs.make("doctor-unreadable-registry-"));
    const sqliteDir = path.join(stateDir, "state");
    fs.mkdirSync(sqliteDir);
    fs.writeFileSync(path.join(sqliteDir, "branch.sqlite"), "not a database");

    expect(
      collectRetainedUnconfiguredAgentDatabaseWarnings({
        cfg: configWithAgents("main"),
        env: { BRANCH_STATE_DIR: stateDir },
      }),
    ).toEqual([expect.stringContaining("Could not inspect retained unconfigured agent databases")]);
  });
});
