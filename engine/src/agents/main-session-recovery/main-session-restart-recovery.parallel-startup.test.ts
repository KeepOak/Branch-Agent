import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import type { InternalSessionEntry as SessionEntry } from "../../config/sessions.js";
import { loadSessionEntry, replaceSessionEntry } from "../../config/sessions/session-accessor.js";
import { callGateway } from "../../gateway/call.js";
import type { GatewayRecoveryRuntime } from "../../gateway/server-instance-runtime.types.js";
import { getAgentEventLifecycleGeneration, resetAgentEventsForTest } from "../../infra/agent-events.js";
import { resetGatewayWorkAdmission } from "../../process/gateway-work-admission.js";
import { cleanupSessionStateForTest } from "../../test-utils/session-state-cleanup.js";
import { createSessionEntry } from "../subagent-test-fixtures.test-helpers.js";
import { createRecoveryRuntimeFixture } from "./main-session-recovery-runtime.test-support.js";
import { createMainSessionRecoveryCapacity } from "./main-session-recovery-capacity.js";
import { createRestartRecoveryTranscriptFixture } from "./main-session-restart-recovery-fixture.test-support.js";
import { recoverRestartAbortedMainSessions } from "./main-session-restart-recovery.js";

vi.mock("../../gateway/call.js", () => ({ callGateway: vi.fn() }));

let tmpDir: string;
const previousStateDir = process.env.BRANCH_STATE_DIR;
let settlement = createDeferred();
const scopes: Array<{ storePath: string; sessionKey: string }> = [];
const { writeTranscript } = createRestartRecoveryTranscriptFixture((storePath) =>
  Object.fromEntries(
    scopes.filter((scope) => scope.storePath === storePath).map((scope) => [
      scope.sessionKey,
      loadSessionEntry(scope) as SessionEntry,
    ]),
  ),
);
const runtime = createRecoveryRuntimeFixture({
  callGateway,
  getDispatchSettlement: () => settlement.promise,
  sendRecoveryNotice: vi.fn<GatewayRecoveryRuntime["sendRecoveryNotice"]>(async () => ({ suppressed: false })),
});
const config = { agents: { list: ["ash", "elm", "oak"].map((id) => ({ id })), defaults: { maxConcurrent: 3 } } };

async function addSession(agentId: string, entryPatch: Partial<SessionEntry> = {}) {
  const sessionsDir = path.join(tmpDir, "agents", agentId, "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  const scope = {
    storePath: path.join(sessionsDir, "sessions.json"),
    sessionKey: `agent:${agentId}:main`,
  };
  const sessionId = `${agentId}-session`;
  await replaceSessionEntry(scope, createSessionEntry({
    sessionId,
    updatedAt: Date.now() - 10_000,
    status: "running",
    abortedLastRun: true,
    ...entryPatch,
  }));
  scopes.push(scope);
  await writeTranscript(sessionsDir, sessionId, [
    { role: "user", content: "keep building" },
    { role: "toolResult", content: "done" },
  ]);
  return scope;
}

beforeEach(async () => {
  vi.clearAllMocks();
  settlement = createDeferred();
  scopes.length = 0;
  resetAgentEventsForTest();
  resetGatewayWorkAdmission();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-parallel-recovery-"));
  process.env.BRANCH_STATE_DIR = tmpDir;
  vi.mocked(callGateway).mockImplementation(async ({ params }) => ({
    runId: (params as { idempotencyKey?: string }).idempotencyKey ?? "recovered",
  }));
});

afterEach(async () => {
  settlement.resolve();
  resetGatewayWorkAdmission();
  await cleanupSessionStateForTest({ stateDir: tmpDir });
  await fs.rm(tmpDir, { recursive: true, force: true });
  if (previousStateDir === undefined) delete process.env.BRANCH_STATE_DIR;
  else process.env.BRANCH_STATE_DIR = previousStateDir;
});

it("starts three agents' interrupted turns before any recovered turn finishes", async () => {
  const targets = await Promise.all([addSession("ash"), addSession("elm"), addSession("oak")]);
  const recovery = recoverRestartAbortedMainSessions({
    cfg: config,
    stateDir: tmpDir,
    gatewayRuntime: runtime,
    recoveryCapacity: createMainSessionRecoveryCapacity({ limit: 3 }),
  });
  try {
    await vi.waitFor(() => expect(callGateway).toHaveBeenCalledTimes(3), { timeout: 60_000 });
    expect(await recovery).toMatchObject({ started: 3, failed: 0 });
    expect(targets.every((scope) => loadSessionEntry(scope)?.abortedLastRun === false)).toBe(true);
  } finally {
    settlement.resolve();
    await recovery;
  }
});

it("waits for reply-dispatch publication and then resumes the same session", async () => {
  const target = await addSession("oak");
  vi.mocked(callGateway).mockRejectedValueOnce(
    new Error("prepared reply dispatch runtime owner was not published for oak"),
  );
  const recovery = recoverRestartAbortedMainSessions({
    cfg: config,
    stateDir: tmpDir,
    gatewayRuntime: runtime,
  });
  try {
    await vi.waitFor(() => expect(callGateway).toHaveBeenCalledTimes(2), { timeout: 60_000 });
    expect(await recovery).toMatchObject({ started: 1, failed: 0 });
    expect(loadSessionEntry(target)).toMatchObject({ sessionId: "oak-session", status: "running", abortedLastRun: false });
  } finally {
    settlement.resolve();
    await recovery;
  }
});

it("reclaims a dead gateway PID's reservation and resumes", async () => {
  const target = await addSession("elm", {
    abortedLastRun: true,
    mainRestartRecovery: {
      cycleId: "old-cycle",
      revision: 1,
      chargedAttempts: 1,
      reservation: {
        runId: "dead-run",
        attempt: 1,
        lifecycleGeneration: getAgentEventLifecycleGeneration(),
        ownerPid: 99999999,
      },
    },
  });
  const recovery = recoverRestartAbortedMainSessions({
    cfg: config,
    stateDir: tmpDir,
    gatewayRuntime: runtime,
  });
  try {
    await vi.waitFor(() => expect(callGateway).toHaveBeenCalledTimes(1), { timeout: 60_000 });
    expect(await recovery).toMatchObject({ started: 1, failed: 0 });
    expect(loadSessionEntry(target)?.mainRestartRecovery?.reservation).toBeUndefined();
    expect(loadSessionEntry(target)?.abortedLastRun).toBe(false);
  } finally {
    settlement.resolve();
    await recovery;
  }
});

it("ends an unrecoverable turn as a visible failed session", async () => {
  const target = await addSession("ash");
  vi.mocked(callGateway).mockRejectedValue(new Error("dispatch unavailable"));
  const recovery = recoverRestartAbortedMainSessions({
    cfg: config,
    stateDir: tmpDir,
    gatewayRuntime: runtime,
    terminalOnFailure: true,
  });
  try {
    expect(await recovery).toMatchObject({ failed: 1 });
    await vi.waitFor(() => expect(loadSessionEntry(target)).toMatchObject({
      status: "failed",
      abortedLastRun: false,
      lastRunError: "Interrupted by a restart. Continue?",
    }), { timeout: 60_000 });
  } finally {
    settlement.resolve();
    await recovery;
  }
});
