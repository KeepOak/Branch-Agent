import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { loadOrCreateDeviceIdentity } from "../../infra/device-identity.js";
import { acquireGatewayStateOwner } from "../../infra/gateway-state-owner.js";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import { fingerprintSessionGoalRequest } from "./session-goal-request.js";

afterEach(() => {
  closeBranchStateDatabaseForTest();
  vi.unstubAllEnvs();
});
const tempDirs = useAutoCleanupTempDirTracker(afterEach);

it("fingerprints chat sends with the cached identity while the state database is busy", () => {
  const stateDir = tempDirs.make("branch-chat-identity-contention-");
  vi.stubEnv("BRANCH_STATE_DIR", stateDir);
  const request = { sessionKey: "agent:test:main", message: "hello" };
  const expected = fingerprintSessionGoalRequest(request);
  closeBranchStateDatabaseForTest();

  // Hold maintenance custody without borrowing its database access scope.
  const blocker = acquireGatewayStateOwner({
    databasePath: path.join(stateDir, "state", "branch.sqlite"),
  });
  try {
    expect(() => loadOrCreateDeviceIdentity()).toThrow("offline maintenance");
    expect(fingerprintSessionGoalRequest(request)).toBe(expected);
    expect(fingerprintSessionGoalRequest({ ...request, message: "changed" })).not.toBe(expected);
  } finally {
    blocker.release();
  }
});
