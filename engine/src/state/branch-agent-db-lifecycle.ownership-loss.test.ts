import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { acquireGatewayLock } from "../infra/gateway-lock.js";
import { captureGatewayStateOwner } from "../infra/gateway-state-owner.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "./branch-agent-db.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
} from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    closeBranchAgentDatabasesForTest();
    await closeBranchStateDatabaseAsync();
    closeBranchStateDatabaseForTest();
    vi.unstubAllEnvs();
    cleanup();
  }),
);

it("closes agent databases after state ownership was really lost, leaving the lease rows to the next owner", async () => {
  const root = tempDirs.make("branch-agent-db-ownership-loss-");
  vi.stubEnv("BRANCH_STATE_DIR", root);
  const gateway = await acquireGatewayLock({
    allowInTests: true,
    env: { BRANCH_STATE_DIR: root },
    timeoutMs: 0,
  });
  if (!gateway) {
    throw new Error("Expected Gateway custody");
  }
  try {
    const owner = captureGatewayStateOwner(path.join(root, "state", "branch.sqlite"));
    const database = openBranchAgentDatabase({ agentId: "main", env: process.env });
    expect(database.db.isOpen).toBe(true);
    // Another process took the state over.
    fs.unlinkSync(gateway.lockPath);
    fs.writeFileSync(gateway.lockPath, "rival");
    expect(() => gateway.assertCurrent()).toThrow("no longer current");
    expect(owner?.signal.aborted).toBe(true);
    // The restart (or stop) can still close every agent database.
    await expect(closeBranchAgentDatabasesAsync()).resolves.toBeUndefined();
    expect(database.db.isOpen).toBe(false);
    // The rival's lock is untouched.
    expect(fs.readFileSync(gateway.lockPath, "utf8")).toBe("rival");
  } finally {
    await gateway.release().catch(() => {});
  }
});
