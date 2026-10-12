// Behaviour tests for the exec always-ask floor wiring (atlas SAFETY-0020). Ports the intent of
// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tests/tools/test_hardline_blocklist.py
// test_yolo_env_var_cannot_bypass_hardline / test_approvals_mode_off_cannot_bypass_hardline onto
// Branch's exec tool, where a floor hit becomes a required human approval.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { captureEnv, deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";
import { resetProcessRegistryForTests } from "./bash-process-registry.test-support.js";
import { createExecTool as createExecToolImpl } from "./bash-tools.exec-run.js";
import { callGatewayTool } from "./tools/gateway.js";

vi.mock("./tools/gateway.js", () => ({
  callGatewayTool: vi.fn(),
  readGatewayCallOptions: vi.fn(() => ({})),
}));

// A fixture named mkfs that only prints, put first on PATH, so the approval binding can resolve it.
// The floor matches the command word; nothing destructive exists to run.
const FLOOR_COMMAND = "mkfs /dev/sdz9";

function installMkfsFixture(root: string): string {
  const binDir = path.join(root, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "mkfs"), "#!/bin/sh\nprintf 'mkfs-fixture %s\\n' \"$*\"\n", {
    mode: 0o755,
  });
  return binDir;
}

const createExecTool = (
  defaults?: Parameters<typeof createExecToolImpl>[0],
): ReturnType<typeof createExecToolImpl> => createExecToolImpl({ agentId: "main", ...defaults });

function mockApprovalGateway(decision: "allow-once" | "deny" | null): string[] {
  const calls: string[] = [];
  vi.mocked(callGatewayTool).mockImplementation(async (method) => {
    calls.push(method);
    if (method === "exec.approval.request") {
      return { status: "accepted", id: "approval-id" };
    }
    if (method === "exec.approval.waitDecision") {
      return { decision };
    }
    return { ok: true };
  });
  return calls;
}

function resultText(result: { content: unknown[] }): string {
  return (result.content[0] as { text?: string }).text ?? "";
}

// POSIX fixture executable, like the other gateway approval tests.
describe.runIf(process.platform !== "win32")("exec always-ask floor", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;
  let tempRoot: string;
  let binDir: string;

  beforeEach(() => {
    envSnapshot = captureEnv([
      "HOME",
      "USERPROFILE",
      "HOMEDRIVE",
      "HOMEPATH",
      "BRANCH_HOME",
      "BRANCH_STATE_DIR",
    ]);
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branch-exec-hardline-floor-"));
    setTestEnvValue("HOME", tempRoot);
    setTestEnvValue("USERPROFILE", tempRoot);
    setTestEnvValue("BRANCH_HOME", tempRoot);
    setTestEnvValue("BRANCH_STATE_DIR", path.join(tempRoot, "state"));
    if (process.platform === "win32") {
      const parsed = path.parse(tempRoot);
      setTestEnvValue("HOMEDRIVE", parsed.root.slice(0, 2));
      setTestEnvValue("HOMEPATH", tempRoot.slice(2) || "\\");
    } else {
      deleteTestEnvValue("HOMEDRIVE");
      deleteTestEnvValue("HOMEPATH");
    }
    binDir = installMkfsFixture(tempRoot);
    resetProcessRegistryForTests();
    vi.mocked(callGatewayTool).mockReset();
  });

  afterEach(() => {
    closeBranchStateDatabaseForTest();
    envSnapshot.restore();
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });

  it("asks before a catastrophic command even in full mode", async () => {
    const calls = mockApprovalGateway("deny");
    const tool = createExecTool({ host: "gateway", mode: "full", pathPrepend: [binDir] });

    const result = await tool.execute("call-floor-full", { command: FLOOR_COMMAND });

    expect(resultText(result)).not.toContain("mkfs-fixture");
    expect(calls).toEqual(["exec.approval.request", "exec.approval.waitDecision"]);
    expect(result.details).toMatchObject({ status: "failed", timedOut: false });
    expect(resultText(result)).toContain("user-denied");
  });

  it("asks even when host approval floors are bypassed for full access", async () => {
    const calls = mockApprovalGateway("deny");
    const tool = createExecTool({
      host: "gateway",
      mode: "full",
      bypassHostApprovalFloors: true,
      pathPrepend: [binDir],
    });

    const result = await tool.execute("call-floor-bypass", { command: FLOOR_COMMAND });

    expect(calls).toEqual(["exec.approval.request", "exec.approval.waitDecision"]);
    expect(result.details).toMatchObject({ status: "failed" });
  });

  it("requests the floor approval with ask always so no durable grant can skip it", async () => {
    mockApprovalGateway("deny");
    const tool = createExecTool({ host: "gateway", mode: "full", pathPrepend: [binDir] });

    await tool.execute("call-floor-ask", { command: FLOOR_COMMAND });

    const request = vi
      .mocked(callGatewayTool)
      .mock.calls.find(([method]) => method === "exec.approval.request");
    expect(JSON.stringify(request)).toContain('"ask":"always"');
  });

  it("keeps quoted prose about catastrophic commands unprompted in full mode", async () => {
    mockApprovalGateway("deny");
    const tool = createExecTool({ host: "gateway", mode: "full", pathPrepend: [binDir] });

    const result = await tool.execute("call-floor-prose", {
      command: 'echo "mkfs.ext4 wipes disks"',
    });

    expect(result.details.status).toBe("completed");
    expect(callGatewayTool).not.toHaveBeenCalled();
  });
});
