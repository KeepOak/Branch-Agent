import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { writeExecApprovalsConfigRow } from "../../infra/exec-approvals-sqlite.js";
import { resolveReusableWorkspaceSkillSnapshot } from "../../skills/runtime/session-snapshot.js";
import * as stateReads from "../../state/branch-state-db-readonly.js";
import {
  closeBranchStateDatabaseAsync,
  openBranchStateDatabase,
} from "../../state/branch-state-db.js";
import { observeMainThreadSql } from "../../test-utils/main-thread-sql-spies.test-support.js";
import { ensureSkillSnapshot } from "./session-updates.js";

// mock-isolation: Session classification reads are outside the approval SQL boundary.
vi.mock("../../agents/sandbox/runtime-status.js", () => ({
  resolveSandboxRuntimeStatus: () => ({ sandboxed: false, sandboxRequired: false }),
}));
// mock-isolation: Remote node discovery is outside the approval-read boundary.
vi.mock("../../skills/runtime/remote.js", () => ({
  getRemoteSkillEligibility: () => undefined,
}));
// mock-isolation: Capture eligibility without filesystem scans or skill watchers.
vi.mock("../../skills/runtime/session-snapshot.js", () => ({
  resolveReusableWorkspaceSkillSnapshot: vi.fn(async () => ({
    snapshot: { prompt: "", skills: [] },
    shouldRefresh: false,
    snapshotVersion: 0,
  })),
}));

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    vi.restoreAllMocks();
    await closeBranchStateDatabaseAsync();
    vi.unstubAllEnvs();
    cleanup();
  }),
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BRANCH_TEST_FAST", "0");
});

function prepare(root: string, config: BranchConfig) {
  return ensureSkillSnapshot({
    cfg: config,
    agentId: "main",
    sessionKey: "agent:main:exec-preparation",
    workspaceDir: path.join(root, "workspace"),
    isFirstTurnInSession: false,
  });
}

const config: BranchConfig = {
  tools: { exec: { host: "node", node: "build-node", mode: "full" } },
};

it("prepares current skill eligibility without caller-thread approval SQL and retains its store", async () => {
  const root = tempDirs.make("branch-skill-exec-");
  const source = openBranchStateDatabase({ env: { BRANCH_STATE_DIR: root } });
  for (const security of ["full", "deny"] as const) {
    writeExecApprovalsConfigRow({ db: source.db, file: { version: 1, defaults: { security } } });
    vi.stubEnv("BRANCH_STATE_DIR", root);
    const calls = observeMainThreadSql();
    const pending = prepare(root, config);
    vi.stubEnv("BRANCH_STATE_DIR", tempDirs.make("branch-foreign-skill-exec-"));
    await pending;
    expect(
      vi.mocked(resolveReusableWorkspaceSkillSnapshot).mock.lastCall?.[0].resolveEligibility?.(),
    ).toMatchObject({ nodeSkills: { canExec: security === "full", node: "build-node" } });
    calls.expectIdle();
    calls.restore();
  }
});

it("does not advertise node skills after the approval worker read fails", async () => {
  const root = tempDirs.make("branch-skill-exec-failure-");
  vi.stubEnv("BRANCH_STATE_DIR", root);
  const source = openBranchStateDatabase();
  writeExecApprovalsConfigRow({
    db: source.db,
    file: { version: 1, defaults: { security: "full" } },
  });
  vi.spyOn(stateReads, "executeExistingBranchStateRead").mockRejectedValue(
    new Error("synthetic approval reader unavailable"),
  );
  const calls = observeMainThreadSql();
  await prepare(root, config);
  expect(
    vi.mocked(resolveReusableWorkspaceSkillSnapshot).mock.lastCall?.[0].resolveEligibility?.(),
  ).toMatchObject({ nodeSkills: { canExec: false, node: "build-node" } });
  calls.expectIdle();
});
